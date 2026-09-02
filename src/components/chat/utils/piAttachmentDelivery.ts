import type { ChatMessage } from '../types/types';

export interface PiAttachmentDelivery { name: string; path: string; status: string; reason?: string }
export const piAttachmentReason = (reason?: string) => ({
  unsupported_type: '此类型不支持直接发送给模型；文件仍在项目中，可使用 read 读取',
  model_no_vision: '当前模型不支持视觉',
  image_too_large: '超过单张图片 8 MB 上限',
  total_image_limit: '超过本轮图片累计 20 MB 上限',
  image_context_limit: '超过会话图片数量或字节预算，未进入模型上下文',
  too_many_attachments: '超过单轮 20 个附件上限',
  file_unavailable: '文件不可读取或为空',
  outside_project: '附件位于允许的项目范围之外',
  image_decode_failed: '图片无法解码或缩放',
} as Record<string, string>)[reason || ''] || reason || '未能发送';

export function applyPiAttachmentDelivery(messages: ChatMessage[], delivery: PiAttachmentDelivery[]): ChatMessage[] {
  if (!Array.isArray(delivery) || !delivery.length) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== 'user') continue;
    if (message.attachments?.length && !message.attachments.some((attachment) => delivery.some((item) => item.path === attachment.path))) continue;
    return messages.map((entry, index) => index === i ? { ...entry, attachmentDelivery: delivery } : entry);
  }
  return messages;
}
