
"use strict";

const commands = [];

function cmd(info, func) {
    if (!info || typeof info !== "object") {
        throw new TypeError("Command info must be an object.");
    }

    if (func !== undefined && typeof func !== "function") {
        throw new TypeError("Command handler must be a function.");
    }

    // Copy the info object without modifying the original
    const data = { ...info };

    // Support cmdname as an alternative to pattern
    if (!data.pattern && data.cmdname) {
        data.pattern = data.cmdname;
    }

    // Normalize command defaults
    if (!Array.isArray(data.alias)) {
        data.alias = data.alias ? [data.alias] : [];
    }

    if (data.dontAddCommandList == null) {
        data.dontAddCommandList = false;
    }

    if (!data.desc) {
        data.desc = "";
    }

    if (data.fromMe == null) {
        data.fromMe = false;
    }

    if (!data.category) {
        data.category = "misc";
    }

    // Attach the command handler when provided
    if (func) {
        data.function = func;
    }

    // Register the command only when a handler exists
    if (typeof data.function !== "function") {
        throw new TypeError(
            `Command "${data.pattern || data.cmdname || "unknown"}" requires a handler function.`
        );
    }

    commands.push(data);

    return data;
}

module.exports = {
    cmd,
    AddCommand: cmd,
    Function: cmd,
    commands,
};

