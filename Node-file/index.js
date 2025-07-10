require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const parsePrompt = require('./services/aiParser');
const { deploy } = require('./services/deployToSalesforce');

const app = express();

// ✅ List of explicitly allowed origins including ngrok or Salesforce
const allowedOrigins = [
    'https://orgfarm-b19a1df799-dev-ed.develop.lightning.force.com',
    'https://login.salesforce.com',
    'https://test.salesforce.com',
    'https://2c10a72c9774.ngrok-free.app' // replace this if ngrok URL changes
];

// ✅ CORS middleware setup
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else if (origin.includes('.lightning.force.com')) {
            callback(null, true); // wildcard match
        } else {
            callback(new Error('Not allowed by CORS: ' + origin));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

// ✅ Body parser middleware
app.use(bodyParser.json());

// ❌ Removed: app.options('*', cors()); (this caused crash)

// ✅ POST endpoint
app.post('/api/generate-metadata', async (req, res) => {
    try {
        const { prompt } = req.body;
        console.log('📩 Received prompt:', prompt);

        const parsedResult = await parsePrompt(prompt);
        console.log('📦 Parsed result:', parsedResult);

        // Pass the full parsedResult to deploy so permissionSets are included
        console.log('🛠️ Object definition ready for deployment:', parsedResult);
        await deploy(parsedResult);
        console.log('✅ Metadata deployed successfully');

        const profileInfo = parsedResult.profileAccess?.length > 0
            ? ` with ${parsedResult.profileAccess.length} profile(s) configured`
            : '';

        res.json({
            message: `✅ Created object ${parsedResult.object} with ${parsedResult.fields.length} fields${profileInfo}.`
        });
    } catch (err) {
        console.error('❌ Error details:', err);
        res.status(500).json({ message: `❌ Error: ${err.message}` });
    }
});

// ✅ Start server
app.listen(3002, () => console.log('🚀 Server running on port 3002'));
