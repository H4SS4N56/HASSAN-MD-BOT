const { getAntideleteStatus } = require('../data/Antidelete');

// Re-sends a deleted message to the chat when antidelete is enabled there.
async function handleAntidelete(conn, updates, store) {
    for (const { key, update } of updates || []) {
        try {
            const isRevoke = update?.message?.protocolMessage?.type === 0 || update?.messageStubType === 1;
            if (!isRevoke || key.fromMe) continue;
            const chatId = key.remoteJid;
            if (!(await getAntideleteStatus(chatId))) continue;
            const original = await store.loadMessage(chatId, key.id);
            if (!original?.message) continue;
            const sender = key.participant || original.key?.participant || chatId;
            await conn.sendMessage(chatId, {
                text: `*🛡️ ANTI-DELETE*\nDeleted by @${sender.split('@')[0]}`,
                mentions: [sender]
            });
            await conn.copyNForward(chatId, original, false).catch(() =>
                conn.sendMessage(chatId, { forward: original }));
        } catch (e) {
            console.error('antidelete error:', e.message);
        }
    }
}

module.exports = { handleAntidelete };
