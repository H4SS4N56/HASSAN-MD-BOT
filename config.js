
"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load .env if available
const envPath = path.join(__dirname, ".env");

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

// Parse boolean environment variables correctly
function getBoolean(name, defaultValue) {
    const value = process.env[name];

    if (value == null || value.trim() === "") {
        return defaultValue;
    }

    return value.trim().toLowerCase() === "true";
}

module.exports = {
    // 1. SESSION & DATABASE
    SESSION_ID: process.env.SESSION_ID || "MINI BOT",

    // Set your NEW MongoDB URI in environment variables.
    // Do not commit database credentials to GitHub.
    MONGODB_URI: process.env.MONGODB_URI || "mongodb+srv://offarslan_db_user:arslanmd@cluster0.xrqkzwg.mongodb.net/?appName=Cluster0",

    // 2. BOT INFORMATION
    PREFIX: process.env.PREFIX || ".",
    OWNER_NUMBER: process.env.OWNER_NUMBER || "+14132248179",

    BOT_NAME: "H4SS4N MD Mini",
    BOT_FOOTER: "© ᴘᴏᴡᴇʀᴇᴅ ʙʏ H4SS4N-ᴍᴅ",

    // public, private, group, inbox
    WORK_TYPE: process.env.WORK_TYPE || "public",

    // 3. STATUS FEATURES
    AUTO_VIEW_STATUS: getBoolean("AUTO_VIEW_STATUS", true),
    AUTO_LIKE_STATUS: getBoolean("AUTO_LIKE_STATUS", true),

    AUTO_LIKE_EMOJI: [
        "❤️", "🌹", "✨", "🥰", "😍",
        "💞", "💕", "☺️", "🤗"
    ],

    AUTO_STATUS_REPLY: getBoolean("AUTO_STATUS_REPLY", false),
    AUTO_STATUS_MSG: process.env.AUTO_STATUS_MSG || "🤗",

    // 4. CHAT & PRESENCE
    READ_MESSAGE: getBoolean("READ_MESSAGE", false),
    AUTO_TYPING: getBoolean("AUTO_TYPING", false),
    AUTO_RECORDING: getBoolean("AUTO_RECORDING", false),

    // 5. GROUP SETTINGS
    WELCOME_ENABLE: getBoolean("WELCOME_ENABLE", true),
    GOODBYE_ENABLE: getBoolean("GOODBYE_ENABLE", true),

    WELCOME_MSG: process.env.WELCOME_MSG || null,
    GOODBYE_MSG: process.env.GOODBYE_MSG || null,

    WELCOME_IMAGE: process.env.WELCOME_IMAGE || null,
    GOODBYE_IMAGE: process.env.GOODBYE_IMAGE || null,

    GROUP_INVITE_LINK:
        process.env.GROUP_INVITE_LINK ||
        "https://chat.whatsapp.com/DSQW0a50RtE0Ys7BmK98m4?s=cl&p=a&mlu=4&ilr=4",

    // 6. SECURITY & ANTI-CALL
    ANTI_CALL: getBoolean("ANTI_CALL", false),
    REJECT_MSG:
        process.env.REJECT_MSG || "*CALL LATER PLEASE ☺️🌹*",

    // 7. IMAGE
    IMAGE_PATH:
        process.env.IMAGE_PATH ||
        "https://files.catbox.moe/prkkzj.png",

    // 8. TELEGRAM
    // Add your rotated Telegram token in Render Environment Variables.
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",

    // Your existing Telegram chat ID is preserved.
    TELEGRAM_CHAT_ID:
        process.env.TELEGRAM_CHAT_ID || "7804161793"
};
