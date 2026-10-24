```javascript
const { cmd } = require("../hassan");
const moment = require("moment");
const { fakevCard } = require("../lib/fakevCard");

const botStartTime = Date.now();
const ALIVE_IMG = "https://files.catbox.moe/6a48t4.png";

cmd({
    pattern: "alive",
    desc: "Check if the bot is active.",
    category: "owner",
    react: "💡",
    filename: __filename
}, async (conn, mek, m, { reply, from }) => {
    try {
        const pushname = m.pushName || "User";
        const currentTime = moment().format("HH:mm:ss");
        const currentDate = moment().format("dddd, MMMM Do YYYY");

        const runtimeMilliseconds = Date.now() - botStartTime;
        const runtimeSeconds = Math.floor(
            (runtimeMilliseconds / 1000) % 60
        );
        const runtimeMinutes = Math.floor(
            (runtimeMilliseconds / (1000 * 60)) % 60
        );
        const runtimeHours = Math.floor(
            runtimeMilliseconds / (1000 * 60 * 60)
        );

        const formattedInfo = `
╭┄┄┄┄[ *ʜᴀssᴀɴ-ᴍᴅ sᴛᴀᴛᴜs* ]┄┄┄┄
┊
┊     Hi 🫵🏽 ${pushname}
┊
┊🕒 *ᴛɪᴍᴇ*: ${currentTime}
┊📅 *ᴅᴀᴛᴇ*: ${currentDate}
┊⏳ *ᴜᴘᴛɪᴍᴇ*: ${runtimeHours} hours, ${runtimeMinutes} minutes, ${runtimeSeconds} seconds
╰───────────────

> 🤖 *Status*: *Hassan-MD-Mini is Alive and Ready!*

🎉 *Enjoy the Service!*
        `.trim();

        if (!ALIVE_IMG || !/^https?:\\/\\//i.test(ALIVE_IMG)) {
            throw new Error("Invalid ALIVE_IMG URL.");
        }

        await conn.sendMessage(from, {
            image: { url: ALIVE_IMG },
            caption: formattedInfo,
            contextInfo: {
                mentionedJid: m.sender ? [m.sender] : [],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: "120363348739987203@newsletter",
                    newsletterName: "ʜᴀssᴀɴ-ᴍᴅ",
                    serverMessageId: 143
                }
            }
        }, { quoted: fakevCard });

    } catch (error) {
        console.error("Error in alive command:", error);
        return reply(
            "❌ An error occurred while processing the alive command.\n" +
            `Error: ${error.message}\n\nPlease check the bot logs.`
        );
    }
});
```
