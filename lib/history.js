import { createHash } from 'node:crypto';

function messageId(event) {
  switch (event?.type) {
    case 'user/message':
      return event.data?.id;
    case 'assistant/message':
    case 'tool/result':
      return event.data?.message?.id;
    default:
      return undefined;
  }
}

/**
 * Recover the append-only messages represented by the selected DSH surface
 * span. Replacement checkpoints cite the surface nodes they shadowed; walking
 * those citations restores the original messages without treating checkpoint
 * text as a new user request.
 */
export function expandSelectedMessages(session, messages) {
  const events = session.events;
  const byId = new Map();
  const bySeq = new Map();
  for (const event of events) {
    bySeq.set(event.seq, event);
    const id = messageId(event);
    if (id !== undefined) byId.set(id, event);
  }

  const sourceSeqs = new Set();
  const visited = new Set();
  const visit = (event) => {
    if (!event || visited.has(event.seq)) return;
    visited.add(event.seq);
    if (event.surfaceOp === 'append') {
      sourceSeqs.add(event.seq);
      return;
    }
    if (event.surfaceOp && typeof event.surfaceOp === 'object' && event.surfaceOp.op === 'replace') {
      for (const seq of event.sourceEventSeqs ?? []) visit(bySeq.get(seq));
    }
  };

  for (const message of messages) visit(byId.get(message.id));

  const ordered = [...sourceSeqs].sort((a, b) => a - b);
  return ordered.map((seq) => {
    const event = bySeq.get(seq);
    return {
      seq,
      time: event.time,
      type: event.type,
      data: event.data,
    };
  });
}

export function stableId(value, width = 24) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, width);
}
