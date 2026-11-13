import { toDisplay } from './display.js'
import { redactText, redactValue } from './redact.js'
import { PROVIDERS } from './model.js'

function success(value) {
  return { kind: 'success', text: JSON.stringify(redactValue(value)) }
}

function failure(message, secret) {
  return { kind: 'error', text: redactText(message, secret ? [secret] : []) }
}

export function commandDefinition(service) {
  return {
    name: 'quota-rings',
    description: '查看订阅额度圆环。侧栏读取不走这条命令；密钥不要输入到对话里。',
    recordInput: false,
    handler: (invocation) => handleQuotaCommand(service, invocation),
  }
}

export async function handleQuotaCommand(service, invocation) {
  const raw = String(invocation?.rawInput ?? '').trim()
  const secret = raw.startsWith('store ') ? raw.slice('store '.length).trim() : ''
  try {
    const [head, arg] = raw.split(/\s+/, 2)
    if (raw === '' || head === 'show') return success(toDisplay(service.snapshot()))
    if (head === 'refresh') {
      if (arg) await service.refreshOne(arg)
      else await service.refreshAll()
      return success(toDisplay(service.snapshot()))
    }
    if (head === 'disable' || head === 'enable') {
      if (!PROVIDERS.includes(arg)) return failure('未知服务商')
      await service.setDisabled(arg, head === 'disable')
      return success(toDisplay(service.snapshot()))
    }
    if (head === 'platform') {
      service.setGlmPlatform(arg)
      return success(toDisplay(service.snapshot()))
    }
    if (head === 'store') {
      if (!secret) return failure('没有收到密钥。请用详情里的密码框，不要把密钥发给模型。')
      const saved = await service.storeGlmToken(secret)
      if (!saved.ok) return failure(saved.message || '钥匙串没有保存密钥。', secret)
      return { kind: 'success', text: 'GLM 密钥已写入本机钥匙串。对话和这条结果都不会显示密钥。' }
    }
    return failure('未知子命令。可用 show、refresh、disable、enable、platform、store。')
  } catch (error) {
    return failure(error instanceof Error ? error.message : '命令失败', secret)
  }
}
