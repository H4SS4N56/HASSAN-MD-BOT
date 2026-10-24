const mongoose = require('mongoose');
const config = require('../config');

// ====================================
// DATABASE CONNECTION
// ====================================

const connectdb = async () => {
    try {
        mongoose.set('strictQuery', false);

        if (!config.MONGODB_URI) {
            throw new Error('MONGODB_URI is missing from config');
        }

        await mongoose.connect(config.MONGODB_URI, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        console.log('✅ [HASSAN-MD] Database connected successfully');
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Database connection failed:',
            error.message
        );
    }
};

// ====================================
// SESSION SCHEMA
// ====================================

const sessionSchema = new mongoose.Schema({
    number: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    credentials: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// ====================================
// BAILEYS AUTHENTICATION KEYS
// ====================================

// Baileys requires credentials AND signal keys.
// main.js serializes key values using BufferJSON before saving them.

const authKeySchema = new mongoose.Schema({
    number: {
        type: String,
        required: true,
        index: true
    },
    category: {
        type: String,
        required: true
    },
    keyId: {
        type: String,
        required: true
    },
    value: {
        type: String,
        required: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    versionKey: false
});

authKeySchema.index(
    { number: 1, category: 1, keyId: 1 },
    { unique: true }
);

// ====================================
// USER CONFIGURATION SCHEMA
// ====================================

const userConfigSchema = new mongoose.Schema({
    number: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    config: {
        AUTO_RECORDING: {
            type: String,
            default: 'false'
        },
        AUTO_TYPING: {
            type: String,
            default: 'false'
        },
        ANTI_CALL: {
            type: String,
            default: 'false'
        },
        REJECT_MSG: {
            type: String,
            default: '*🔕 Your call was automatically rejected!*'
        },
        READ_MESSAGE: {
            type: String,
            default: 'false'
        },
        AUTO_VIEW_STATUS: {
            type: String,
            default: 'false'
        },
        AUTO_LIKE_STATUS: {
            type: String,
            default: 'false'
        },
        AUTO_STATUS_REPLY: {
            type: String,
            default: 'false'
        },
        AUTO_STATUS_MSG: {
            type: String,
            default: 'Hello from HASSAN-MD'
        },
        AUTO_LIKE_EMOJI: {
            type: Array,
            default: ['❤️', '👍', '😮', '😎']
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// ====================================
// OTP SCHEMA
// ====================================

const otpSchema = new mongoose.Schema({
    number: {
        type: String,
        required: true,
        index: true
    },
    otp: {
        type: String,
        required: true
    },
    config: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 5 * 60 * 1000),
        index: { expires: '5m' }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// ====================================
// ACTIVE NUMBER SCHEMA
// ====================================

const activeNumberSchema = new mongoose.Schema({
    number: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    lastConnected: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    },
    connectionInfo: {
        ip: String,
        userAgent: String,
        timestamp: Date
    }
});

// ====================================
// STATISTICS SCHEMA
// ====================================

const statsSchema = new mongoose.Schema({
    number: {
        type: String,
        required: true
    },
    date: {
        type: String,
        required: true
    },
    commandsUsed: {
        type: Number,
        default: 0
    },
    messagesReceived: {
        type: Number,
        default: 0
    },
    messagesSent: {
        type: Number,
        default: 0
    },
    groupsInteracted: {
        type: Number,
        default: 0
    }
});

statsSchema.index(
    { number: 1, date: 1 },
    { unique: true }
);

// ====================================
// REGISTER MODELS
// ====================================

const Session = mongoose.model('Session', sessionSchema);
const AuthKey = mongoose.model('AuthKey', authKeySchema);
const UserConfig = mongoose.model('UserConfig', userConfigSchema);
const OTP = mongoose.model('OTP', otpSchema);
const ActiveNumber = mongoose.model('ActiveNumber', activeNumberSchema);
const Stats = mongoose.model('Stats', statsSchema);

// ====================================
// HELPER
// ====================================

function cleanNumber(number) {
    return String(number || '').replace(/[^0-9]/g, '');
}

// ====================================
// SAVE SESSION CREDENTIALS
// Used by main.js
// ====================================

async function saveSessionToMongoDB(number, credentials) {
    try {
        const phone = cleanNumber(number);

        if (!phone || !credentials || typeof credentials !== 'object') {
            throw new Error('Valid number and credentials are required');
        }

        await Session.findOneAndUpdate(
            { number: phone },
            {
                $set: {
                    credentials,
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: new Date()
                }
            },
            {
                upsert: true,
                new: true,
                runValidators: true
            }
        );

        console.log(`💾 [HASSAN-MD] Credentials saved for ${phone}`);
        return true;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to save credentials:',
            error.message
        );
        return false;
    }
}

// ====================================
// GET SESSION CREDENTIALS
// Used by main.js
// ====================================

async function getSessionFromMongoDB(number) {
    try {
        const phone = cleanNumber(number);
        if (!phone) return null;

        const session = await Session.findOne({
            number: phone
        }).lean();

        return session ? session.credentials : null;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to retrieve credentials:',
            error.message
        );
        return null;
    }
}

// ====================================
// DELETE COMPLETE SESSION
// ====================================

async function deleteSessionFromMongoDB(number) {
    try {
        const phone = cleanNumber(number);
        if (!phone) return false;

        await Promise.all([
            Session.deleteOne({ number: phone }),
            AuthKey.deleteMany({ number: phone }),
            ActiveNumber.deleteOne({ number: phone })
        ]);

        console.log(`🗑️ [HASSAN-MD] Session deleted for ${phone}`);
        return true;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to delete session:',
            error.message
        );
        return false;
    }
}

// ====================================
// GET BAILEYS AUTHENTICATION KEYS
// Used by useMongoAuthState() in main.js
// ====================================

async function getAuthKeysFromMongoDB(number, category, ids) {
    try {
        const phone = cleanNumber(number);

        if (
            !phone ||
            !category ||
            !Array.isArray(ids) ||
            ids.length === 0
        ) {
            return {};
        }

        const records = await AuthKey.find({
            number: phone,
            category: String(category),
            keyId: { $in: ids.map(String) }
        }).lean();

        const result = {};

        for (const record of records) {
            result[record.keyId] = record.value;
        }

        return result;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to load auth keys:',
            error.message
        );

        // Throw so main.js can detect authentication-storage failures.
        throw error;
    }
}

// ====================================
// SAVE BAILEYS AUTHENTICATION KEYS
// Used by useMongoAuthState() in main.js
// ====================================

async function setAuthKeysInMongoDB(number, data) {
    const phone = cleanNumber(number);

    if (!phone || !data || typeof data !== 'object') {
        throw new Error('Invalid number or auth-key data');
    }

    try {
        const operations = [];

        for (const [category, entries] of Object.entries(data)) {
            if (!entries || typeof entries !== 'object') {
                continue;
            }

            for (const [keyId, value] of Object.entries(entries)) {
                const filter = {
                    number: phone,
                    category: String(category),
                    keyId: String(keyId)
                };

                // Baileys uses null to indicate a key should be removed.
                if (value === null || value === undefined) {
                    operations.push({
                        deleteOne: { filter }
                    });

                    continue;
                }

                // main.js already serializes values using BufferJSON.
                // Keep strings unchanged to avoid double-encoding JSON.
                const serializedValue = typeof value === 'string'
                    ? value
                    : JSON.stringify(value);

                operations.push({
                    updateOne: {
                        filter,
                        update: {
                            $set: {
                                value: serializedValue,
                                updatedAt: new Date()
                            }
                        },
                        upsert: true
                    }
                });
            }
        }

        if (operations.length > 0) {
            await AuthKey.bulkWrite(operations, {
                ordered: false
            });
        }

        return true;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to save auth keys:',
            error.message
        );

        // Do not silently treat a failed key save as success.
        throw error;
    }
}

// ====================================
// DELETE BAILEYS AUTHENTICATION KEYS
// ====================================

async function deleteAuthKeysFromMongoDB(number) {
    try {
        const phone = cleanNumber(number);
        if (!phone) return false;

        await AuthKey.deleteMany({ number: phone });

        console.log(`🗑️ [HASSAN-MD] Auth keys deleted for ${phone}`);
        return true;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to delete auth keys:',
            error.message
        );
        return false;
    }
}

// ====================================
// DEFAULT USER CONFIGURATION
// ====================================

function getDefaultUserConfig() {
    return {
        AUTO_RECORDING: 'false',
        AUTO_TYPING: 'false',
        ANTI_CALL: 'false',
        REJECT_MSG: '*🔕 Your call was automatically rejected!*',
        READ_MESSAGE: 'false',
        AUTO_VIEW_STATUS: 'true',
        AUTO_LIKE_STATUS: 'true',
        AUTO_STATUS_REPLY: 'false',
        AUTO_STATUS_MSG: 'Hello from HASSAN-MD',
        AUTO_LIKE_EMOJI: ['❤️', '👍', '😮', '😎']
    };
}

// ====================================
// GET USER CONFIGURATION
// ====================================

async function getUserConfigFromMongoDB(number) {
    try {
        const phone = cleanNumber(number);
        if (!phone) return {};

        let userConfig = await UserConfig.findOne({
            number: phone
        }).lean();

        if (userConfig) {
            return userConfig.config || getDefaultUserConfig();
        }

        const defaultConfig = getDefaultUserConfig();

        // Upsert avoids a duplicate-key race if two requests arrive together.
        userConfig = await UserConfig.findOneAndUpdate(
            { number: phone },
            {
                $setOnInsert: {
                    number: phone,
                    config: defaultConfig,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        ).lean();

        return userConfig?.config || defaultConfig;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to get user config:',
            error.message
        );

        return getDefaultUserConfig();
    }
}

// ====================================
// UPDATE USER CONFIGURATION
// ====================================

async function updateUserConfigInMongoDB(number, newConfig) {
    try {
        const phone = cleanNumber(number);

        if (
            !phone ||
            !newConfig ||
            typeof newConfig !== 'object' ||
            Array.isArray(newConfig)
        ) {
            return false;
        }

        await UserConfig.findOneAndUpdate(
            { number: phone },
            {
                $set: {
                    config: newConfig,
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: new Date()
                }
            },
            {
                upsert: true,
                new: true
            }
        );

        console.log(`⚙️ [HASSAN-MD] Config updated for ${phone}`);
        return true;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to update user config:',
            error.message
        );

        return false;
    }
}

// ====================================
// SAVE OTP
// ====================================

async function saveOTPToMongoDB(number, otp, userConfig) {
    try {
        const phone = cleanNumber(number);

        if (!phone || !otp || !userConfig) {
            return false;
        }

        await OTP.create({
            number: phone,
            otp: String(otp),
            config: userConfig,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        console.log(`🔐 [HASSAN-MD] OTP saved for ${phone}`);
        return true;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to save OTP:',
            error.message
        );

        return false;
    }
}

// ====================================
// VERIFY OTP
// ====================================

async function verifyOTPFromMongoDB(number, otp) {
    try {
        const phone = cleanNumber(number);

        const record = await OTP.findOne({
            number: phone,
            otp: String(otp),
            expiresAt: { $gt: new Date() }
        });

        if (!record) {
            return {
                valid: false,
                error: 'Invalid or expired OTP'
            };
        }

        await OTP.deleteOne({ _id: record._id });

        return {
            valid: true,
            config: record.config
        };
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to verify OTP:',
            error.message
        );

        return {
            valid: false,
            error: 'Verification error'
        };
    }
}

// ====================================
// ADD / UPDATE ACTIVE NUMBER
// ====================================

async function addNumberToMongoDB(number) {
    try {
        const phone = cleanNumber(number);
        if (!phone) return false;

        await ActiveNumber.findOneAndUpdate(
            { number: phone },
            {
                $set: {
                    lastConnected: new Date(),
                    isActive: true
                },
                $setOnInsert: {
                    number: phone
                }
            },
            {
                upsert: true,
                new: true
            }
        );

        return true;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to add active number:',
            error.message
        );

        return false;
    }
}

// ====================================
// REMOVE ACTIVE NUMBER
// ====================================

async function removeNumberFromMongoDB(number) {
    try {
        const phone = cleanNumber(number);
        if (!phone) return false;

        await ActiveNumber.deleteOne({ number: phone });
        return true;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to remove active number:',
            error.message
        );

        return false;
    }
}

// ====================================
// GET ALL ACTIVE NUMBERS
// Used for auto-reconnect by main.js
// ====================================

async function getAllNumbersFromMongoDB() {
    try {
        const records = await ActiveNumber.find({
            isActive: true
        })
            .select('number -_id')
            .lean();

        return records.map(record => record.number);
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to get active numbers:',
            error.message
        );

        return [];
    }
}

// ====================================
// INCREMENT STATISTICS
// ====================================

const allowedStatFields = new Set([
    'commandsUsed',
    'messagesReceived',
    'messagesSent',
    'groupsInteracted'
]);

async function incrementStats(number, field) {
    try {
        const phone = cleanNumber(number);

        if (!phone || !allowedStatFields.has(field)) {
            return false;
        }

        // Use UTC date consistently.
        const today = new Date().toISOString().slice(0, 10);

        await Stats.findOneAndUpdate(
            {
                number: phone,
                date: today
            },
            {
                $inc: { [field]: 1 },
                $setOnInsert: {
                    number: phone,
                    date: today
                }
            },
            {
                upsert: true,
                new: true
            }
        );

        return true;
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to increment statistics:',
            error.message
        );

        return false;
    }
}

// ====================================
// GET STATISTICS FOR A NUMBER
// ====================================

async function getStatsForNumber(number) {
    try {
        const phone = cleanNumber(number);
        if (!phone) return [];

        return await Stats.find({
            number: phone
        })
            .sort({ date: -1 })
            .limit(30)
            .lean();
    } catch (error) {
        console.error(
            '❌ [HASSAN-MD] Failed to get statistics:',
            error.message
        );

        return [];
    }
}

// ====================================
// EXPORTS — KEEP THESE NAMES
// COMPATIBLE WITH YOUR EXISTING main.js
// ====================================

module.exports = {
    connectdb,

    // Models
    Session,
    AuthKey,
    UserConfig,
    OTP,
    ActiveNumber,
    Stats,

    // Session credentials
    saveSessionToMongoDB,
    getSessionFromMongoDB,
    deleteSessionFromMongoDB,

    // Baileys authentication keys
    getAuthKeysFromMongoDB,
    setAuthKeysInMongoDB,
    deleteAuthKeysFromMongoDB,

    // User configuration
    getUserConfigFromMongoDB,
    updateUserConfigInMongoDB,

    // OTP
    saveOTPToMongoDB,
    verifyOTPFromMongoDB,

    // Active numbers
    addNumberToMongoDB,
    removeNumberFromMongoDB,
    getAllNumbersFromMongoDB,

    // Statistics
    incrementStats,
    getStatsForNumber,

    // Backward compatibility
    getUserConfig: async (number) => {
        return await getUserConfigFromMongoDB(number);
    },

    updateUserConfig: updateUserConfigInMongoDB
};

// Powered by HASSAN-MD
