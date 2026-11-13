import Foundation
import Darwin
import Security

/// Signed identity of the installed DeepSeek Harness app (Info.plist / codesign).
/// Same-user plugins inside that signed app share this identity. This is not isolation
/// from other plugins of the same app, and it is not a path-substring check.
let expectedIdentifier = "com.deepseek.dsh"
let expectedTeam = "NAN929V4UM"

/// Only these entries belong to this plugin. Other plugins in the same signed app
/// share the code identity, so this allowlist is the plugin-level boundary, not a
/// claim of strong isolation between plugins of the same app.
let allowedService = "dsh-provider-quota-rings"
let allowedAccounts: Set<String> = ["glm", "opencode"]
let maxInputBytes = 16 * 1024

func parentCode() -> SecCode? {
    var code: SecCode?
    let attributes = [kSecGuestAttributePid: NSNumber(value: getppid())] as CFDictionary
    let status = SecCodeCopyGuestWithAttributes(nil, attributes, [], &code)
    guard status == errSecSuccess else { return nil }
    return code
}

func callerAllowed() -> Bool {
    guard let code = parentCode() else { return false }
    let validity = SecCodeCheckValidity(code, [], nil)
    guard validity == errSecSuccess else { return false }

    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else {
        return false
    }

    var info: CFDictionary?
    let copyStatus = SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info)
    guard copyStatus == errSecSuccess, let info = info as? [String: Any] else { return false }

    let identifier = info[kSecCodeInfoIdentifier as String] as? String ?? ""
    let team = info[kSecCodeInfoTeamIdentifier as String] as? String
    let family = identifier == expectedIdentifier || identifier.hasPrefix("\(expectedIdentifier).")
    return family && team == expectedTeam
}

struct Request: Decodable {
    var op: String
    var service: String?
    var account: String?
    var secret: String?
}

func emit(_ fields: [String: Any]) -> Never {
    let data = try? JSONSerialization.data(withJSONObject: fields)
    if let data {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    } else {
        FileHandle.standardOutput.write(Data("{\"ok\":false,\"code\":\"encode\"}\n".utf8))
    }
    let ok = fields["ok"] as? Bool == true
    exit(ok ? 0 : 1)
}

func audit(_ op: String, account: String?, ok: Bool, code: String? = nil) {
    var line: [String: Any] = [
        "audit": "quota-keychain",
        "op": op,
        "pid": getpid(),
        "ppid": getppid(),
        "ok": ok,
        "time": ISO8601DateFormatter().string(from: Date()),
    ]
    if let account { line["account"] = account }
    if let code { line["code"] = code }
    if let data = try? JSONSerialization.data(withJSONObject: line),
       let text = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(Data((text + "\n").utf8))
    }
}

func finish(_ op: String, account: String?, _ fields: [String: Any]) -> Never {
    audit(op, account: account, ok: fields["ok"] as? Bool == true, code: fields["code"] as? String)
    emit(fields)
}

func requestOp(_ raw: Data) -> String {
    guard let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { return "unknown" }
    return object["op"] as? String ?? "unknown"
}

func readBoundedInput(_ handle: FileHandle, limit: Int) -> Data? {
    var data = Data()
    while data.count <= limit {
        let remaining = limit + 1 - data.count
        guard remaining > 0 else { return nil }
        guard let chunk = try? handle.read(upToCount: min(remaining, 4096)), !chunk.isEmpty else {
            return data
        }
        data.append(chunk)
    }
    return nil
}

let allowedOps: Set<String> = ["ping", "get", "set", "delete"]
guard let raw = readBoundedInput(FileHandle.standardInput, limit: maxInputBytes) else {
    finish("unknown", account: nil, ["ok": false, "code": "bad-request"])
}
guard let request = try? JSONDecoder().decode(Request.self, from: raw), allowedOps.contains(request.op) else {
    finish(requestOp(raw), account: nil, ["ok": false, "code": "bad-request"])
}

if request.op == "ping" {
    finish("ping", account: nil, ["ok": true, "op": "ping"])
}

if !callerAllowed() {
    finish(request.op, account: request.account, ["ok": false, "code": "caller-rejected"])
}

guard let service = request.service, service == allowedService,
      let account = request.account, allowedAccounts.contains(account) else {
    finish(request.op, account: request.account, ["ok": false, "code": "not-allowed"])
}

let base: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]

switch request.op {
case "set":
    guard let secret = request.secret, !secret.isEmpty else {
        finish("set", account: account, ["ok": false, "code": "empty"])
    }
    SecItemDelete(base as CFDictionary)
    var add = base
    add[kSecValueData as String] = Data(secret.utf8)
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let status = SecItemAdd(add as CFDictionary, nil)
    finish("set", account: account, status == errSecSuccess ? ["ok": true, "op": "set"] : ["ok": false, "code": "keychain-failed"])
case "get":
    var query = base
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data, let secret = String(data: data, encoding: .utf8) else {
        finish("get", account: account, ["ok": false, "code": "not-found"])
    }
    finish("get", account: account, ["ok": true, "op": "get", "secret": secret])
case "delete":
    let status = SecItemDelete(base as CFDictionary)
    let gone = status == errSecSuccess || status == errSecItemNotFound
    finish("delete", account: account, gone ? ["ok": true, "op": "delete"] : ["ok": false, "code": "keychain-failed"])
default:
    finish(request.op, account: account, ["ok": false, "code": "bad-op"])
}
