
"use strict";

const express = require("express");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({
    extended: true,
    limit: "1mb"
}));

// Load pairing/session routes
const pairRouter = require("./main");
app.use("/", pairRouter);

// Basic health check
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        message: "HASSAN-MD server is running"
    });
});

// Handle unknown routes
app.use((req, res) => {
    res.status(404).json({
        status: "error",
        message: "Route not found"
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error("Server error:", err.message);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        status: "error",
        message: "Internal server error"
    });
});

// Start server only when run directly
if (require.main === module) {
    app.listen(port, "0.0.0.0", () => {
        console.log(`🚀 HASSAN-MD server running on port ${port}`);
    });
}

module.exports = app;
