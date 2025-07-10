const fs = require('fs');
const { deploy } = require('./services/deployToSalesforce');

async function deployFromFile(filename) {
    try {
        console.log(`📁 Reading file: ${filename}`);
        
        if (!fs.existsSync(filename)) {
            console.error(`❌ File not found: ${filename}`);
            return;
        }
        
        const fileContent = fs.readFileSync(filename, 'utf8');
        const objectDef = JSON.parse(fileContent);
        
        console.log(`📦 Object definition:`, objectDef);
        console.log(`🎯 Deploying to Salesforce...`);
        
        await deploy(objectDef);
        
        console.log(`✅ Deployment completed successfully!`);
    } catch (error) {
        console.error(`❌ Deployment failed:`, error.message);
        process.exit(1);
    }
}

// Get filename from command line arguments
const filename = process.argv[2];

if (!filename) {
    console.error('❌ Please provide a JSON file name');
    console.log('Usage: node deploy-file.js <filename.json>');
    process.exit(1);
}

deployFromFile(filename); 