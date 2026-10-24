const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    Browsers,
    DisconnectReason,
    jidDecode,
    downloadContentFromMessage,
    getContentType,
} = require('@whiskeysockets/baileys');

const { arslanmd } = require('./lib/system');
const config = require('./config');
const events = require('./hassan');
const { sms } = require('./lib/msg');

const {
    connectdb,
    saveSessionToMongoDB,
    getSessionFromMongoDB,
    deleteSessionFromMongoDB,
    getUserConfigFromMongoDB,
    updateUserConfigInMongoDB,
    addNumberToMongoDB,
    removeNumberFromMongoDB,
    getAllNumbersFromMongoDB,
    saveOTPToMongoDB,
    verifyOTPFromMongoDB,
    incrementStats,
    getStatsForNumber
} = require('./lib/database');

const { handleAntidelete } = require('./lib/antidelete');

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const crypto = require('crypto');
const FileType = require('file-type');
const axios = require('axios');
const moment = require('moment-timezone');

const prefix = config.PREFIX;
const mode = config.MODE || config.WORK_TYPE;
const router = express.Router();

connectdb();

const activeSockets = new Map();
const socketCreationTime = new Map();

function createarslanStore() {
    const store = {
        messages: {},

        bind(ev) {
            ev.on('messages.upsert', ({ messages }) => {
                for (const msg of messages) {
                    const jid = msg.key && msg.key.remoteJid;

                    if (!jid) continue;

                    if (!store.messages[jid]) {
                        store.messages[jid] = [];
                    }

                    store.messages[jid].push(msg);

                    if (store.messages[jid].length > 200) {
                        store.messages[jid].shift();
                    }
                }
            });
        },

        async loadMessage(jid, id) {
            if (!store.messages[jid]) return null;

            return store.messages[jid].find(
                m => m.key && m.key.id === id
            ) || null;
        }
    };

    return store;
}

// Utility functions
const createSerial = (size) =>
    crypto.randomBytes(size).toString('hex').slice(0, size);

const getGroupAdmins = (participants) => {
    const admins = [];

    for (const participant of participants) {
        if (participant.admin == null) continue;
        admins.push(participant.id);
    }

    return admins;
};

function isNumberAlreadyConnected(number) {
    return activeSockets.has(
        String(number).replace(/[^0-9]/g, '')
    );
}

function getConnectionStatus(number) {
    const n = String(number).replace(/[^0-9]/g, '');
    const isConnected = activeSockets.has(n);
    const connectionTime = socketCreationTime.get(n);

    return {
        isConnected,
        connectionTime: connectionTime
            ? new Date(connectionTime).toLocaleString()
            : null,
        uptime: connectionTime
            ? Math.floor((Date.now() - connectionTime) / 1000)
            : 0
    };
}

function arslanLog(message, type = 'info') {
    const icons = {
        info: '📝',
        success: '✅',
        error: '❌',
        warning: '⚠️',
        debug: '🐛'
    };

    console.log(
        `${icons[type] || '📝'} [HASSAN-MD] ${new Date().toISOString()}: ${message}`
    );
}

// Load plugins
const pluginsDir = path.join(__dirname, 'plugins');

if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
}

const pluginFiles = fs.readdirSync(pluginsDir)
    .filter(file => file.endsWith('.js'));

arslanLog(`Loading ${pluginFiles.length} plugins...`, 'info');

for (const file of pluginFiles) {
    try {
        require(path.join(pluginsDir, file));
    } catch (error) {
        arslanLog(
            `Failed to load plugin ${file}: ${error.message}`,
            'error'
        );
    }
}

async function setupCallHandlers(socket, number) {
    socket.ev.on('call', async (calls) => {
        try {
            const userConfig = await getUserConfigFromMongoDB(number);

            if (userConfig.ANTI_CALL !== 'true') return;

            for (const call of calls) {
                if (call.status !== 'offer') continue;

                await socket.rejectCall(call.id, call.from);

                await socket.sendMessage(call.from, {
                    text: userConfig.REJECT_MSG || config.REJECT_MSG
                });

                arslanLog(
                    `Auto-rejected call for ${number} from ${call.from}`,
                    'info'
                );
            }
        } catch (error) {
            arslanLog(
                `Anti-call error for ${number}: ${error.message}`,
                'error'
            );
        }
    });
}

function setupAutoRestart(socket, number) {
    let restartAttempts = 0;
    const maxRestartAttempts = 3;

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode =
                lastDisconnect &&
                lastDisconnect.error &&
                lastDisconnect.error.output &&
                lastDisconnect.error.output.statusCode;

            const errorMessage =
                lastDisconnect &&
                lastDisconnect.error &&
                lastDisconnect.error.message;

            arslanLog(
                `Connection closed for ${number}: ${statusCode} - ${errorMessage}`,
                'warning'
            );

            const sanitizedNumber = String(number).replace(/[^0-9]/g, '');

            if (
                statusCode === 401 ||
                (errorMessage && errorMessage.includes('401'))
            ) {
                arslanLog(
                    `Session logged out for ${sanitizedNumber}; cleaning up...`,
                    'warning'
                );

                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);

                await deleteSessionFromMongoDB(sanitizedNumber);
                await removeNumberFromMongoDB(sanitizedNumber);

                socket.ev.removeAllListeners();
                return;
            }

            const isNormalError =
                statusCode === 408 ||
                (errorMessage &&
                    errorMessage.includes('QR refs attempts ended'));

            if (isNormalError) {
                arslanLog(
                    `Normal closure for ${number}; no restart needed.`,
                    'info'
                );
                return;
            }

            if (restartAttempts < maxRestartAttempts) {
                restartAttempts++;

                arslanLog(
                    `Reconnecting ${number} (${restartAttempts}/${maxRestartAttempts}) in 10 seconds...`,
                    'warning'
                );

                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);

                socket.ev.removeAllListeners();

                await delay(10000);

                try {
                    const mockRes = {
                        headersSent: false,
                        send: () => {},
                        status: () => mockRes,
                        setHeader: () => {},
                        json: () => {}
                    };

                    await arslanPair(number, mockRes);
                } catch (error) {
                    arslanLog(
                        `Reconnection failed for ${number}: ${error.message}`,
                        'error'
                    );
                }
            } else {
                arslanLog(
                    `Max restart attempts reached for ${number}.`,
                    'error'
                );
            }
        }

        if (connection === 'open') {
            restartAttempts = 0;
        }
    });
}

async function arslanPair(number, res = null) {
    let connectionLockKey;

    const sanitizedNumber = String(number).replace(/[^0-9]/g, '');

    try {
        const sessionPath = path.join(
            __dirname,
            'session',
            `session_${sanitizedNumber}`
        );

        if (isNumberAlreadyConnected(sanitizedNumber)) {
            const status = getConnectionStatus(sanitizedNumber);

            if (res && !res.headersSent) {
                return res.json({
                    status: 'already_connected',
                    message: 'Number is already connected',
                    connectionTime: status.connectionTime,
                    uptime: `${status.uptime} seconds`
                });
            }

            return;
        }

        connectionLockKey = `hassan_lock_${sanitizedNumber}`;

        if (global[connectionLockKey]) {
            if (res && !res.headersSent) {
                return res.json({
                    status: 'connection_in_progress'
                });
            }

            return;
        }

        global[connectionLockKey] = true;

        // Check MongoDB session
        const existingSession =
            await getSessionFromMongoDB(sanitizedNumber);

        if (!existingSession) {
            arslanLog(
                `No MongoDB session for ${sanitizedNumber} — new pairing required`,
                'info'
            );

            if (fs.existsSync(sessionPath)) {
                await fs.remove(sessionPath);

                arslanLog(
                    `Cleaned leftover local session for ${sanitizedNumber}`,
                    'info'
                );
            }
        } else {
            // Restore the credentials saved in MongoDB.
            fs.ensureDirSync(sessionPath);

            fs.writeFileSync(
                path.join(sessionPath, 'creds.json'),
                JSON.stringify(existingSession, null, 2)
            );

            arslanLog(
                `Restored existing session from MongoDB for ${sanitizedNumber}`,
                'success'
            );
        }

            const { state, saveCreds } =
            await useMultiFileAuthState(sessionPath);

        const logger = pino({
            level: process.env.NODE_ENV === 'production'
                ? 'fatal'
                : 'debug'
        });

        const arslanStore = createarslanStore();

        const conn = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },

            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            version: [2, 3000, 1033105955],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: true,
            markOnlineOnConnect: true,
            browser: ['Mac OS', 'Safari', '10.15.7'],

            getMessage: async (key) => {
                const msg = await arslanStore.loadMessage(
                    key.remoteJid,
                    key.id
                );

                return msg && msg.message
                    ? msg.message
                    : { conversation: 'HASSAN-MD' };
            }
        });

        socketCreationTime.set(sanitizedNumber, Date.now());
        activeSockets.set(sanitizedNumber, conn);

        arslanStore.bind(conn.ev);

        // Setup handlers
        setupCallHandlers(conn, sanitizedNumber);
        setupAutoRestart(conn, sanitizedNumber);

        // Decode JID utility
        conn.decodeJid = (jid) => {
            if (!jid) return jid;

            if (/:\\d+@/gi.test(jid)) {
                const decoded = jidDecode(jid) || {};

                return (
                    decoded.user &&
                    decoded.server &&
                    decoded.user + '@' + decoded.server
                ) || jid;
            }

            return jid;
        };

        // Download and save media
        conn.downloadAndSaveMediaMessage = async (
            message,
            filename,
            attachExtension = true
        ) => {
            const quoted = message.msg ? message.msg : message;
            const mime = (message.msg || message).mimetype || '';

            const messageType = message.mtype
                ? message.mtype.replace(/Message/gi, '')
                : mime.split('/')[0];

            const stream = await downloadContentFromMessage(
                quoted,
                messageType
            );

            let buffer = Buffer.from([]);

            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            const type = await FileType.fromBuffer(buffer);

            const trueFileName = attachExtension
                ? `${filename}.${type ? type.ext : 'bin'}`
                : filename;

            await fs.writeFile(trueFileName, buffer);

            return trueFileName;
        };

        // Pairing code
        if (!conn.authState.creds.registered) {
            arslanLog(
                `Starting new pairing process for ${sanitizedNumber}`,
                'info'
            );

            try {
                await delay(1500);

                const code = await conn.requestPairingCode(
                    sanitizedNumber
                );

                arslanLog(
                    `Pairing code generated for ${sanitizedNumber}`,
                    'success'
                );

                if (res && !res.headersSent) {
                    res.send({
                        code,
                        status: 'new_pairing'
                    });
                }
            } catch (error) {
                arslanLog(
                    `Failed to request pairing code: ${error.message}`,
                    'error'
                );

                if (res && !res.headersSent) {
                    res.status(500).send({
                        error: 'Failed to get pairing code',
                        status: 'error'
                    });
                }

                throw error;
            }
        } else {
            arslanLog(
                `Using existing session for ${sanitizedNumber}`,
                'success'
            );

            if (res && !res.headersSent) {
                res.json({
                    status: 'reconnecting',
                    message: 'Reconnecting with existing session'
                });
            }
        }

        // Save credentials when updated
        conn.ev.on('creds.update', async () => {
            try {
                await saveCreds();

                const credsPath = path.join(sessionPath, 'creds.json');
                const fileContent = await fs.readFile(
                    credsPath,
                    'utf8'
                );

                const creds = JSON.parse(fileContent);

                const existingSessionCheck =
                    await getSessionFromMongoDB(sanitizedNumber);

                const isNewSession = !existingSessionCheck;

                await saveSessionToMongoDB(
                    sanitizedNumber,
                    creds
                );

                if (isNewSession) {
                    arslanLog(
                        `New user ${sanitizedNumber} successfully registered`,
                        'success'
                    );
                }
            } catch (error) {
                arslanLog(
                    `Credential save error: ${error.message}`,
                    'error'
                );
            }
        });

        // Anti-delete handler
        conn.ev.on('messages.update', async (updates) => {
            try {
                await handleAntidelete(
                    conn,
                    updates,
                    arslanStore
                );
            } catch (error) {
                arslanLog(
                    `Anti-delete error: ${error.message}`,
                    'error'
                );
            }
        });

        // Connection updates
        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                try {
                    await arslanmd(conn);

                    arslanLog(
                        `Connected: ${sanitizedNumber}`,
                        'success'
                    );

                    const userJid = jidNormalizedUser(conn.user.id);

                    await addNumberToMongoDB(sanitizedNumber);

                    if (!existingSession) {
                        await conn.sendMessage(userJid, {
                            image: { url: config.IMAGE_PATH },

                            caption:
                                `\n╭────────────────────◇\n` +
                                `│✦ *HASSAN-MD — CONNECTED* 🔥\n` +
                                `│✦ Type *${prefix}menu* to see all commands 💫\n` +
                                `│✦ Prefix 『 ${prefix} 』  Mode 〔${mode}〕\n` +
                                `╰────────────────────○\n` +
                                `*© Powered by HASSAN-MD*`
                        });
                    }
                } catch (error) {
                    arslanLog(
                        `Connection-open handler error: ${error.message}`,
                        'error'
                    );
                }
            }

            if (connection === 'close') {
                const reason =
                    lastDisconnect &&
                    lastDisconnect.error &&
                    lastDisconnect.error.output &&
                    lastDisconnect.error.output.statusCode;

                if (reason === DisconnectReason.loggedOut) {
                    arslanLog('Session logged out.', 'error');
                }
            }
        });

        // Incoming messages
        conn.ev.on('messages.upsert', async (msg) => {
            try {
                const mek = msg.messages[0];

                if (!mek || !mek.message) return;

                const userConfig =
                    await getUserConfigFromMongoDB(sanitizedNumber);

                mek.message =
                    getContentType(mek.message) === 'ephemeralMessage'
                        ? mek.message.ephemeralMessage.message
                        : mek.message;

                if (userConfig.READ_MESSAGE === 'true') {
                    await conn.readMessages([mek.key]);
                }

                // Newsletter reactions
                const newsletterJids = [
                    '120363348739987203@newsletter'
                ];

                const newsEmojis = [
                    '❤️', '👍', '😮', '😎',
                    '💀', '💫', '🔥', '👑'
                ];

                if (
                    mek.key &&
                    newsletterJids.includes(mek.key.remoteJid)
                ) {
                    try {
                        const serverId = mek.newsletterServerId;

                        if (serverId) {
                            const emoji = newsEmojis[
                                Math.floor(Math.random() * newsEmojis.length)
                            ];

                            await conn.newsletterReactMessage(
                                mek.key.remoteJid,
                                serverId.toString(),
                                emoji
                            );
                        }
                    } catch (_) {}
                }

                // Status handling
                if (
                    mek.key &&
                    mek.key.remoteJid === 'status@broadcast'
                ) {
                    if (userConfig.AUTO_VIEW_STATUS === 'true') {
                        await conn.readMessages([mek.key]);
                    }

                    if (userConfig.AUTO_LIKE_STATUS === 'true') {
                        const botJid = await conn.decodeJid(
                            conn.user.id
                        );

                        const emojis =
                            userConfig.AUTO_LIKE_EMOJI ||
                            config.AUTO_LIKE_EMOJI;

                        const randomEmoji = emojis[
                            Math.floor(Math.random() * emojis.length)
                        ];

                        await conn.sendMessage(
                            mek.key.remoteJid,
                            {
                                react: {
                                    text: randomEmoji,
                                    key: mek.key
                                }
                            },
                            {
                                statusJidList: [
                                    mek.key.participant,
                                    botJid
                                ]
                            }
                        );
                    }

                    if (userConfig.AUTO_STATUS_REPLY === 'true') {
                        const user = mek.key.participant;

                        await conn.sendMessage(
                            user,
                            {
                                text:
                                    userConfig.AUTO_STATUS_MSG ||
                                    config.AUTO_STATUS_MSG
                            },
                            { quoted: mek }
                        );
                    }

                    return;
                }

                const m = sms(conn, mek);
                const type = getContentType(mek.message);
                const from = mek.key.remoteJid;

                const body =
                    type === 'conversation'
                        ? mek.message.conversation
                        : type === 'extendedTextMessage'
                            ? mek.message.extendedTextMessage.text
                            : '';

                const isCmd = body.startsWith(config.PREFIX);

                const command = isCmd
                    ? body.slice(config.PREFIX.length)
                        .trim()
                        .split(' ')
                        .shift()
                        .toLowerCase()
                    : '';

                const args = body.trim().split(/ +/).slice(1);
                const q = args.join(' ');
                const text = q;
                const isGroup = from.endsWith('@g.us');

                const sender = mek.key.fromMe
                    ? conn.user.id.split(':')[0] + '@s.whatsapp.net'
                    : mek.key.participant || mek.key.remoteJid;

                const senderNumber = sender.split('@')[0];
                const botNumber = conn.user.id.split(':')[0];
                const botNumber2 = await jidNormalizedUser(conn.user.id);
                const pushname = mek.pushName || 'User';

                const isMe = botNumber.includes(senderNumber);

                const ownerNumber = String(
                    config.OWNER_NUMBER || ''
                ).replace(/[^0-9]/g, '');

                const isOwner =
                    (ownerNumber &&
                        ownerNumber === senderNumber.replace(/[^0-9]/g, '')) ||
                    isMe;

                const isCreator = isOwner;

                let groupMetadata = null;
                let groupName = null;
                let participants = null;
                let groupAdmins = null;
                let isBotAdmins = null;
                let isAdmins = null;

                if (isGroup) {
                    try {
                        groupMetadata = await conn.groupMetadata(from);
                        groupName = groupMetadata.subject;
                        participants = groupMetadata.participants;

                        groupAdmins = getGroupAdmins(participants);
                        isBotAdmins = groupAdmins.includes(botNumber2);
                        isAdmins = groupAdmins.includes(sender);
                    } catch (_) {}
                }

                if (userConfig.AUTO_TYPING === 'true') {
                    await conn.sendPresenceUpdate('composing', from);
                }

                if (userConfig.AUTO_RECORDING === 'true') {
                    await conn.sendPresenceUpdate('recording', from);
                }

                const myquoted = {
                    key: {
                        remoteJid: 'status@broadcast',
                        participant: '13135550002@s.whatsapp.net',
                        fromMe: false,
                        id: createSerial(16).toUpperCase()
                    },

                    message: {
                        contactMessage: {
                            displayName: '© HASSAN-MD',

                            vcard:
                                `BEGIN:VCARD\n` +
                                `VERSION:3.0\n` +
                                `FN:HASSAN-MD BOY\n` +
                                `ORG:HASSAN-MD BOY;\n` +
                                `TEL;type=CELL;type=VOICE;waid=13135550002:13135550002\n` +
                                `END:VCARD`,

                            contextInfo: {
                                stanzaId: createSerial(16).toUpperCase(),
                                participant: '0@s.whatsapp.net',
                                quotedMessage: {
                                    conversation: '© HASSAN-MD'
                                }
                            }
                        }
                    },

                    messageTimestamp: Math.floor(Date.now() / 1000),
                    status: 1,
                    verifiedBizName: 'Meta'
                };

                            const reply = (messageText) =>
                    conn.sendMessage(
                        from,
                        { text: messageText },
                        { quoted: myquoted }
                    );

                const l = reply;

                // Execute commands
                if (isCmd) {
                    await incrementStats(
                        sanitizedNumber,
                        'commandsUsed'
                    );

                    const cmd =
                        events.commands.find(
                            item => item.pattern === command
                        ) ||
                        events.commands.find(
                            item =>
                                item.alias &&
                                item.alias.includes(command)
                        );

                    if (cmd) {
                        if (
                            config.WORK_TYPE === 'private' &&
                            !isOwner
                        ) {
                            return;
                        }

                        if (cmd.react) {
                            await conn.sendMessage(from, {
                                react: {
                                    text: cmd.react,
                                    key: mek.key
                                }
                            });
                        }

                        try {
                            await cmd.function(conn, mek, m, {
                                from,
                                quoted: mek,
                                body,
                                isCmd,
                                command,
                                args,
                                q,
                                text,
                                isGroup,
                                sender,
                                senderNumber,
                                botNumber2,
                                botNumber,
                                pushname,
                                isMe,
                                isOwner,
                                isCreator,
                                groupMetadata,
                                groupName,
                                participants,
                                groupAdmins,
                                isBotAdmins,
                                isAdmins,
                                reply,
                                config,
                                myquoted
                            });
                        } catch (error) {
                            arslanLog(
                                `PLUGIN ERROR [${command}]: ${error.message}`,
                                'error'
                            );
                        }
                    }
                }

                await incrementStats(
                    sanitizedNumber,
                    'messagesReceived'
                );

                if (isGroup) {
                    await incrementStats(
                        sanitizedNumber,
                        'groupsInteracted'
                    );
                }

                const ctx = {
                    from,
                    l,
                    quoted: mek,
                    body,
                    isCmd,
                    command,
                    args,
                    q,
                    text,
                    isGroup,
                    sender,
                    senderNumber,
                    botNumber2,
                    botNumber,
                    pushname,
                    isMe,
                    isOwner,
                    isCreator,
                    groupMetadata,
                    groupName,
                    participants,
                    groupAdmins,
                    isBotAdmins,
                    isAdmins,
                    reply,
                    config,
                    myquoted
                };

                // Execute event plugins
                for (const evCmd of events.commands) {
                    try {
                        if (body && evCmd.on === 'body') {
                            await evCmd.function(conn, mek, m, ctx);
                        } else if (mek.q && evCmd.on === 'text') {
                            await evCmd.function(conn, mek, m, ctx);
                        } else if (
                            (evCmd.on === 'image' ||
                                evCmd.on === 'photo') &&
                            mek.type === 'imageMessage'
                        ) {
                            await evCmd.function(conn, mek, m, ctx);
                        } else if (
                            evCmd.on === 'sticker' &&
                            mek.type === 'stickerMessage'
                        ) {
                            await evCmd.function(conn, mek, m, ctx);
                        }
                    } catch (pluginError) {
                        arslanLog(
                            `PLUGIN EVENT ERROR: ${pluginError.message}`,
                            'error'
                        );
                    }
                }
            } catch (error) {
                arslanLog(
                    `Message handler error: ${error.message}`,
                    'error'
                );
            }
        });
    } catch (error) {
        arslanLog(
            `HASSAN-MD Pair error: ${error.message}`,
            'error'
        );

        if (res && !res.headersSent) {
            return res.status(500).json({
                error: 'Internal Server Error'
            });
        }
    } finally {
        if (connectionLockKey) {
            global[connectionLockKey] = false;
        }
    }
}

// Protect administrative endpoints.
// Set ADMIN_TOKEN in your hosting environment.
// Send it as Authorization: Bearer YOUR_TOKEN
// or as x-admin-token: YOUR_TOKEN.
function requireAdminToken(req, res, next) {
    const expected = process.env.ADMIN_TOKEN;

    if (!expected) {
        return res.status(503).json({
            error: 'Admin endpoints are disabled. Configure ADMIN_TOKEN.'
        });
    }

    const supplied = String(
        req.get('x-admin-token') ||
        req.get('authorization') ||
        ''
    ).replace(/^Bearer\s+/i, '').trim();

    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);

    if (
        expectedBuffer.length !== suppliedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
        return res.status(401).json({
            error: 'Unauthorized'
        });
    }

    next();
}

// Main pairing page
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Request a pairing code
router.get('/code', async (req, res) => {
    try {
        const number = String(req.query.number || '')
            .replace(/[^0-9]/g, '');

        if (!number) {
            return res.status(400).json({
                error: 'Number required'
            });
        }

        if (number.length < 8 || number.length > 15) {
            return res.status(400).json({
                error: 'Number must contain 8 to 15 digits, including country code.'
            });
        }

        await arslanPair(number, res);
    } catch (error) {
        arslanLog(
            `Pairing route error: ${error.message}`,
            'error'
        );

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Failed to process pairing request'
            });
        }
    }
});

// Connection status
router.get('/status', (req, res) => {
    const { number } = req.query;

    // Listing all connected numbers requires admin authentication.
    if (!number) {
        return requireAdminToken(req, res, () => {
            const connections = Array.from(activeSockets.keys()).map(n => {
                const status = getConnectionStatus(n);

                return {
                    number: n,
                    status: 'connected',
                    connectionTime: status.connectionTime,
                    uptime: `${status.uptime} seconds`
                };
            });

            return res.json({
                totalActive: activeSockets.size,
                connections
            });
        });
    }

    // Only report the status for the requested number.
    const status = getConnectionStatus(number);

    res.json({
        number,
        isConnected: status.isConnected,
        connectionTime: status.connectionTime,
        uptime: `${status.uptime} seconds`
    });
});

// Disconnect a number
router.get('/disconnect', requireAdminToken, async (req, res) => {
    const { number } = req.query;

    if (!number) {
        return res.status(400).json({
            error: 'Number required'
        });
    }

    const n = String(number).replace(/[^0-9]/g, '');

    if (!activeSockets.has(n)) {
        return res.status(404).json({
            error: 'Connection not found'
        });
    }

    try {
        const socket = activeSockets.get(n);

        await socket.ws.close();
        socket.ev.removeAllListeners();

        activeSockets.delete(n);
        socketCreationTime.delete(n);

        await removeNumberFromMongoDB(n);
        await deleteSessionFromMongoDB(n);

        res.json({
            status: 'success',
            message: 'Disconnected'
        });
    } catch (error) {
        arslanLog(
            `Disconnect error: ${error.message}`,
            'error'
        );

        res.status(500).json({
            error: 'Failed to disconnect'
        });
    }
});

// List active numbers (admin only)
router.get('/active', requireAdminToken, (req, res) => {
    res.json({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

// Public health check
router.get('/ping', (req, res) => {
    res.json({
        status: 'active',
        message: 'HASSAN-MD is running',
        activeSessions: activeSockets.size
    });
});

// Reconnect saved numbers (admin only)
router.get('/connect-all', requireAdminToken, async (req, res) => {
    try {
        const numbers = await getAllNumbersFromMongoDB();

        if (!numbers.length) {
            return res.status(404).json({
                error: 'No saved numbers found'
            });
        }

        const results = [];

        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({
                    number,
                    status: 'already_connected'
                });

                continue;
            }

            const mockRes = {
                headersSent: false,
                json: () => {},
                send: () => {},
                status: () => mockRes
            };

            await arslanPair(number, mockRes);

            results.push({
                number,
                status: 'connection_initiated'
            });

            await delay(1000);
        }

        res.json({
            status: 'success',
            total: numbers.length,
            connections: results
        });
    } catch (error) {
        arslanLog(
            `Connect-all error: ${error.message}`,
            'error'
        );

        res.status(500).json({
            error: 'Failed to reconnect saved numbers'
        });
    }
});

// Request configuration update OTP (admin only)
router.get('/update-config', requireAdminToken, async (req, res) => {
    try {
        const { number, config: configString } = req.query;

        if (!number || !configString) {
            return res.status(400).json({
                error: 'Number and config are required'
            });
        }

        let newConfig;

        try {
            newConfig = JSON.parse(configString);
        } catch (_) {
            return res.status(400).json({
                error: 'Invalid config JSON'
            });
        }

        const n = String(number).replace(/[^0-9]/g, '');
        const socket = activeSockets.get(n);

        if (!socket) {
            return res.status(404).json({
                error: 'No active session'
            });
        }

        const otp = crypto.randomInt(100000, 1000000).toString();

        await saveOTPToMongoDB(n, otp, newConfig);

        await socket.sendMessage(
            jidNormalizedUser(socket.user.id),
            {
                text:
                    `*🔐 HASSAN-MD — CONFIG UPDATE*\n\n` +
                    `OTP: *${otp}*\n` +
                    `Valid for 5 minutes`
            }
        );

        res.json({
            status: 'otp_sent'
        });
    } catch (error) {
        arslanLog(
            `Update-config error: ${error.message}`,
            'error'
        );

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Failed to send configuration OTP'
            });
        }
    }
});

// Verify configuration OTP (admin only)
router.get('/verify-otp', requireAdminToken, async (req, res) => {
    try {
        const { number, otp } = req.query;

        if (!number || !otp) {
            return res.status(400).json({
                error: 'Number and OTP are required'
            });
        }

        const n = String(number).replace(/[^0-9]/g, '');

        const verification = await verifyOTPFromMongoDB(n, otp);

        if (!verification.valid) {
            return res.status(400).json({
                error: verification.error
            });
        }

        await updateUserConfigInMongoDB(
            n,
            verification.config
        );

        const socket = activeSockets.get(n);

        if (socket) {
            await socket.sendMessage(
                jidNormalizedUser(socket.user.id),
                {
                    text: '*✅ HASSAN-MD CONFIG UPDATED*'
                }
            );
        }

        res.json({
            status: 'success'
        });
    } catch (error) {
        arslanLog(
            `OTP verification error: ${error.message}`,
            'error'
        );

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Failed to verify OTP'
            });
        }
    }
});

// Statistics (admin only)
router.get('/stats', requireAdminToken, async (req, res) => {
    const { number } = req.query;

    if (!number) {
        return res.status(400).json({
            error: 'Number required'
        });
    }

    try {
        const n = String(number).replace(/[^0-9]/g, '');

        const stats = await getStatsForNumber(n);
        const status = getConnectionStatus(n);

        res.json({
            number: n,
            connectionStatus: status.isConnected
                ? 'Connected'
                : 'Disconnected',
            uptime: status.uptime,
            stats
        });
    } catch (error) {
        arslanLog(
            `Stats error: ${error.message}`,
            'error'
        );

        res.status(500).json({
            error: 'Failed to fetch statistics'
        });
    }
});

// Reconnect saved WhatsApp sessions from MongoDB
async function autoReconnectFromMongoDB() {
    try {
        arslanLog(
            'Attempting auto-reconnect from MongoDB...',
            'info'
        );

        const numbers = await getAllNumbersFromMongoDB();

        if (!numbers.length) {
            arslanLog('No numbers found in MongoDB', 'info');
            return;
        }

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = {
                    headersSent: false,
                    json: () => {},
                    send: () => {},
                    status: () => mockRes
                };

                await arslanPair(number, mockRes);
                await delay(2000);
            }
        }

        arslanLog(
            'Auto-reconnect completed',
            'success'
        );
    } catch (error) {
        arslanLog(
            `autoReconnectFromMongoDB error: ${error.message}`,
            'error'
        );
    }
}

setTimeout(() => {
    autoReconnectFromMongoDB();
}, 3000);

// Do not delete the session directory during shutdown.
// It contains WhatsApp authentication data.
process.on('uncaughtException', (error) => {
    arslanLog(
        `Uncaught exception: ${error.message}`,
        'error'
    );
});

module.exports = router;
