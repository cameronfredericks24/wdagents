// index.js - REVISED AND FULLY IMPLEMENTED
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { exec } from "child_process";
import fs from "fs-extra";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";

// Add ES module __dirname and __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === CONFIGURATION ===
// IMPORTANT: It's highly recommended to use environment variables for secrets.
const GEMINI_API_KEY = "AIzaSyAtD7KKw-TiH7Tnu6ti-mf_7mfeCfgH6E0"; // PASTE YOUR KEY HERE or use process.env.GEMINI_API_KEY
const PORT = process.env.PORT || 3001;
const SF_ORG_ALIAS = "AgentOrg"; // <-- Using your connected org alias
const TMP_DIR = path.join(process.cwd(), "tmp");
// Assuming your SF project is one level up from the 'backend' folder
const PROJECT_DIR = path.resolve(__dirname, "../Project1");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// === GOOGLE GENAI SETUP ===
if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("YOUR_GEMINI_API_KEY")) {
    console.error("FATAL ERROR: The GEMINI_API_KEY is not configured. Please set it.");
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// =================================================================
// METADATA CLEANING FUNCTIONS
// =================================================================
function cleanXml(xmlString) { return xmlString.replace(/```xml\n?|```/g, "").trim(); }
function removeActionOverrides(xml) { return xml.replace(/<actionOverrides\s*\/?>[\s\S]*?<\/actionOverrides>|<actionOverrides\s*\/?>/gi, ''); }
function removeLookupPhonetic(xml) { return xml.replace(/<lookupPhonetic\s*\/?>[\s\S]*?<\/lookupPhonetic>|<lookupPhonetic\s*\/?>/gi, ''); }
function removeEmptyLookupFilter(xml) { return xml.replace(/<lookupFilter>\s*<\/lookupFilter>/gi, ''); }
function removeEmptySearchLayouts(xml) { return xml.replace(/<searchLayouts\s*\/?>[\s\S]*?<\/searchLayouts>|<searchLayouts\s*\/?>/gi, ''); }
function fixErrorDisplayField(xml) { return xml.replace(/<errorDisplayField>\s*false\s*<\/errorDisplayField>/gi, ''); }
function removeEmptyTags(xml) { return xml.replace(/<([a-zA-Z0-9_]+)\s*><\/\1>/g, '').replace(/<([a-zA-Z0-9_]+)\s*\/?>\s*<\/\1>/g, ''); }
function ensureNameFieldLabel(xml) { return xml.replace(/<nameField>([\s\S]*?)(<type>.*?<\/type>)([\s\S]*?)<\/nameField>/g, (match, before, typeTag, after) => { if (/<label>[\s\S]*?<\/label>/.test(match)) return match; return `<nameField>${before}<label>Record Name</label>${typeTag}${after}</nameField>`; }); }
function removeObjectLevelActive(xml) { return xml.replace(/(<CustomObject[\s\S]*?>)([\s\S]*?)(<active>[\s\S]*?<\/active>)([\s\S]*?<fields>)/g, (match, start, before, activeTag, after) => { return `${start}${before.replace(/<active>[\s\S]*?<\/active>/g, '')}${after}`; }); }
function removeAllActiveTags(xml) { return xml.replace(/<active>[\s\S]*?<\/active>/gi, ''); }
function ensureActiveInValidationRules(xml) { let result = xml.replace(/<active>[\s\S]*?<\/active>/gi, ''); result = result.replace(/<validationRules>([\s\S]*?)(<\/validationRules>)/g, (match, content, closeTag) => { if (/<active>[\s\S]*?<\/active>/.test(content)) return match; return `<validationRules>${content}<active>true</active>${closeTag}`; }); return result; }
function fixHelpTextTag(xml) { return xml.replace(/<helpText>/gi, '<inlineHelpText>').replace(/<\/helpText>/gi, '</inlineHelpText>'); }
function ensureActiveInRecordTypes(xml) { return xml.replace(/<recordTypes(\s[^>]*)?>([\s\S]*?)(<\/recordTypes>)/g, (match, attrs, content, closeTag) => { if (/<active>[\s\S]*?<\/active>/i.test(content)) return match; return `<recordTypes${attrs || ''}>${content}<active>true</active>${closeTag}`; }); }
function removeLengthFromTextArea(xml) { return xml.replace(/<fields>([\s\S]*?<type>TextArea<\/type>[\s\S]*?)<length>[\s\S]*?<\/length>([\s\S]*?<\/fields>)/g, '$1$2'); }
function removeDeleteConstraintFromUserLookups(xml) { return xml.replace(/(<fields>[\s\S]*?<type>Lookup<\/type>[\s\S]*?<referenceTo>User<\/referenceTo>[\s\S]*?)<deleteConstraint>[\s\S]*?<\/deleteConstraint>([\s\S]*?<\/fields>)/g, '$1$2'); }
function addDeleteConstraintToRequiredLookups(xml) { return xml.replace(/(<fields>[\s\S]*?<type>Lookup<\/type>[\s\S]*?<required>true<\/required>[\s\S]*?)(<\/fields>)/g, (match, content, closeTag) => { if (/deleteConstraint/.test(content)) return match; return `${content}<deleteConstraint>Restrict</deleteConstraint>${closeTag}`; }); }
function ensureEnableHistoryIfFieldTracked(xml) { if (/<trackHistory>true<\/trackHistory>/.test(xml) && !/<enableHistory>true<\/enableHistory>/.test(xml)) { return xml.replace(/(<pluralLabel>.*?<\/pluralLabel>)/, '$1\n    <enableHistory>true</enableHistory>'); } return xml; }
function ensureDeploymentStatus(xml) { if (!/<deploymentStatus>.*?<\/deploymentStatus>/.test(xml)) { return xml.replace(/<\/label>/, '</label>\n    <deploymentStatus>Deployed</deploymentStatus>'); } return xml; }
function removeApiVersionTag(xml) { return xml.replace(/<apiVersion>.*?<\/apiVersion>/gi, ''); }
function removeInvalidRecordNameField(xml) { return xml.replace(/<recordNameField>.*?<\/recordNameField>/gi, ''); }
function removeObjectLevelExternalId(xml) { return xml.replace(/(<CustomObject[\s\S]*?>)([\s\S]*?)(<externalId>[\s\S]*?<\/externalId>)([\s\S]*?<fields>)/g, (match, start, before, externalIdTag, after) => { return `${start}${before.replace(/<externalId>[\s\S]*?<\/externalId>/g, '')}${after}`; }); }
function removeDuplicateLabels(xml) { 
    // Remove duplicate label elements - keep only the first one at object level
    // This specifically targets the case where there's a label at object level and another in nameField
    return xml.replace(/(<CustomObject[\s\S]*?<label>[^<]+<\/label>[\s\S]*?<nameField>[\s\S]*?<label>[^<]+<\/label>[\s\S]*?<\/nameField>)/g, (match, content) => {
        // Remove the label from within nameField, keep the object-level label
        return content.replace(/<nameField>([\s\S]*?)<label>[^<]+<\/label>([\s\S]*?)<\/nameField>/g, '<nameField>$1$2</nameField>');
    });
}
function convertCustomFieldToFields(xml) { return xml.replace(/<CustomField[^>]*>([\s\S]*?)<\/CustomField>/g, (match, content) => { const cleanedContent = content.replace(/<fullName>[^.]*\.([^<]*)<\/fullName>/g, '<fullName>$1</fullName>'); return `<fields>${cleanedContent}</fields>`; }); }

// [COMPLETED] This function now correctly pipelines field-specific cleaning rules.
function cleanStandardObjectFieldMetadata(xml) {
    let result = xml;
    // Chain relevant cleaning functions for standard object fields.
    // These functions operate safely on field definitions.
    result = fixHelpTextTag(result);
    result = removeApiVersionTag(result);
    result = removeEmptyTags(result);
    result = removeLengthFromTextArea(result);
    result = removeDeleteConstraintFromUserLookups(result);
    result = addDeleteConstraintToRequiredLookups(result);
    return result;
}

// This function is for custom objects.
function postProcessXml(xml) {
    let result = xml;
    // Chain all your relevant cleaning functions for a full CustomObject file here
    result = removeActionOverrides(result); result = removeLookupPhonetic(result); result = removeEmptyLookupFilter(result); result = removeEmptySearchLayouts(result); result = fixErrorDisplayField(result); result = fixHelpTextTag(result); result = removeApiVersionTag(result); result = removeInvalidRecordNameField(result); result = removeObjectLevelExternalId(result); result = removeDuplicateLabels(result); result = removeEmptyTags(result); result = ensureNameFieldLabel(result); result = removeObjectLevelActive(result); result = removeAllActiveTags(result); result = ensureActiveInValidationRules(result); result = ensureActiveInRecordTypes(result); result = removeLengthFromTextArea(result); result = removeDeleteConstraintFromUserLookups(result); result = addDeleteConstraintToRequiredLookups(result); result = ensureEnableHistoryIfFieldTracked(result); result = ensureDeploymentStatus(result);
    return result;
}
// =================================================================

// === AI CHAIN IMPLEMENTATION (USING JSON) ===
async function runAiAnalyst(userInput) {
    console.log("Phase 1: Running AI Business Analyst...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
    const analystPrompt = `
        You are an expert Salesforce Business Analyst. Your task is to analyze a user's request and convert it into a structured JSON specification.

        You MUST classify the intent as "CustomObject" (for a new object) or "CustomField" (for adding fields to an existing object).
        
        CRITICAL RULES for JSON content:
        1. The 'fields' array should ONLY contain NEW custom fields to be created.
        2. Do NOT include standard fields like 'Owner' or the 'Record Name' in the 'fields' array.
        3. The 'recordNameField' property is EXCLUSIVELY for defining the standard Name field (e.g., its label and type).
        4. For Lookup fields, if the user asks for multiple targets (e.g., "Lead or Opportunity"), create a single lookup field and list the targets in a "targets" array within properties. The Developer AI will handle this.

        **If intent is "CustomObject":**
        {
          "metadataType": "CustomObject",
          "objectApiName": "ObjectName__c",
          "objectLabel": "Object Label",
          "pluralLabel": "Plural Label",
          "recordNameField": { "label": "Record Name Label", "type": "Text" },
          "fields": [
            { "label": "Field 1", "apiName": "Field_1__c", "type": "Text", "properties": { "length": 255 } }
          ]
        }

        **If intent is "CustomField":**
        {
          "metadataType": "CustomField",
          "objectApiName": "StandardOrCustomObjectName",
          "fields": [
            { "label": "Field 1", "apiName": "Field_1__c", "type": "Text", "properties": { "length": 255 } }
          ]
        }
        
        Analyze the following user request and generate the correct JSON.
        User Request: "${userInput}"
    `;
    try {
        const result = await model.generateContent(analystPrompt);
        const structuredSpec = JSON.parse(result.response.text());
        console.log("AI Analyst Output:", JSON.stringify(structuredSpec, null, 2));
        return structuredSpec;
    } catch (error) {
        console.error("Error in runAiAnalyst:", error);
        throw new Error("Failed to get structured data from AI Analyst.");
    }
}
async function runAiDeveloper(structuredSpec) {
    console.log(`Phase 2: Running AI Developer for metadataType: ${structuredSpec.metadataType}`);
    console.log("DEBUG: structuredSpec received by Developer AI:", JSON.stringify(structuredSpec, null, 2));
    
    if (structuredSpec.metadataType === 'CustomObject') {
        // Generate XML using a template instead of AI
        let fieldsXml = '';
        
        for (const field of structuredSpec.fields) {
            let fieldXml = `    <fields>
        <fullName>${field.apiName}</fullName>
        <externalId>false</externalId>
        <label>${field.label}</label>`;
            
            if (field.type === 'Lookup') {
                const target = field.properties.targets[0]; // Use first target only
                fieldXml += `
        <referenceTo>${target}</referenceTo>
        <relationshipLabel>${structuredSpec.pluralLabel}</relationshipLabel>
        <relationshipName>${structuredSpec.pluralLabel.replace(/\s+/g, '_')}</relationshipName>
        <required>false</required>
        <trackFeedHistory>false</trackFeedHistory>
        <type>Lookup</type>`;
            } else if (field.type === 'Picklist') {
                fieldXml += `
        <picklist>`;
                for (const value of field.properties.picklistValues) {
                    fieldXml += `
            <picklistValues>
                <fullName>${value.value}</fullName>
                <label>${value.label}</label>
            </picklistValues>`;
                }
                fieldXml += `
            <sorted>false</sorted>
        </picklist>
        <required>false</required>
        <trackFeedHistory>false</trackFeedHistory>
        <type>Picklist</type>`;
            } else if (field.type === 'TextArea') {
                fieldXml += `
        <length>${field.properties.length}</length>
        <trackFeedHistory>false</trackFeedHistory>
        <type>TextArea</type>`;
            } else if (field.type === 'Text') {
                fieldXml += `
        <length>${field.properties.length}</length>
        <required>false</required>
        <trackFeedHistory>false</trackFeedHistory>
        <type>Text</type>`;
            }
            
            fieldXml += `
    </fields>`;
            fieldsXml += fieldXml;
        }
        
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <deploymentStatus>Deployed</deploymentStatus>
    <label>${structuredSpec.objectLabel}</label>
    <nameField>
        <label>${structuredSpec.recordNameField.label}</label>
        <type>${structuredSpec.recordNameField.type}</type>
    </nameField>
    <pluralLabel>${structuredSpec.pluralLabel}</pluralLabel>
    <sharingModel>ReadWrite</sharingModel>${fieldsXml}
</CustomObject>`;
        
        return xml;
    } else if (structuredSpec.metadataType === 'CustomField') {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const developerPrompt = `
            You are an expert AI Salesforce Developer. For the EXISTING object **${structuredSpec.objectApiName}**, generate one or more Salesforce custom field XML definitions based on the provided JSON.

            CRITICAL RULES:
            1. Generate each field as its own INDIVIDUAL <CustomField> XML structure with the namespace.
            2. Concatenate all <CustomField> blocks together. Do NOT wrap them in any other tag.
            3. **DO NOT** invent or include unrelated metadata tags.
            4. For Lookup fields: A custom lookup field can only reference ONE object. If the JSON 'targets' property has multiple values, **PICK ONLY THE FIRST ONE** for the <referenceTo> tag.

            JSON Specification: ${JSON.stringify(structuredSpec, null, 2)}
            
            Now, generate the XML blocks for the fields, each with the xmlns="http://soap.sforce.com/2006/04/metadata" attribute.
        `;
        
        try {
            const result = await model.generateContent(developerPrompt);
            return result.response.text();
        } catch (error) {
            console.error("Error in runAiDeveloper:", error);
            throw new Error("Failed to generate metadata XML from AI Developer.");
        }
    } else {
        throw new Error(`Unknown metadataType: ${structuredSpec.metadataType}`);
    }
}

// === API ENDPOINTS ===

app.post("/api/metadata/generate", async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: "Prompt is required." });
        const structuredSpec = await runAiAnalyst(prompt);
        let rawXml = await runAiDeveloper(structuredSpec);
        rawXml = cleanXml(rawXml);
        res.json({ metadataPreview: rawXml, deploymentInfo: structuredSpec });
    } catch (err) {
        console.error('Generate endpoint error:', err.message);
        res.status(500).json({ error: `An error occurred during generation: ${err.message}` });
    }
});

const deployJobs = {}; // [ADDED] In-memory store for deployment job statuses

app.post("/api/metadata/deploy", async (req, res) => {
    console.log("=== DEPLOYMENT REQUEST RECEIVED ===");
    console.log("Request body:", JSON.stringify(req.body, null, 2));
    console.log("Request headers:", req.headers);
    
    const jobId = uuidv4();
    const jobDir = path.join(TMP_DIR, jobId);
    const mdapiDir = path.join(jobDir, 'mdapi');

    try {
        // Handle both field name variations
        const metadataXml = req.body.metadataXml || req.body.metadata;
        const deploymentInfo = req.body.deploymentInfo || req.body.deploymentInfo;
        
        console.log("Extracted metadataXml:", metadataXml ? "PRESENT" : "MISSING");
        console.log("Extracted deploymentInfo:", deploymentInfo ? "PRESENT" : "MISSING");
        
        if (!metadataXml) {
            console.log("400 ERROR: Missing metadataXml/metadata field");
            return res.status(400).json({ error: "Either 'metadataXml' or 'metadata' field is required." });
        }
        
        // If deploymentInfo is missing, we'll create a basic one from the metadata
        let finalDeploymentInfo = deploymentInfo;
        if (!deploymentInfo) {
            console.log("Creating deploymentInfo from metadata content");
            // Try to extract object name from the XML
            const objectNameMatch = metadataXml.match(/<label>([^<]+)<\/label>/);
            const objectName = objectNameMatch ? objectNameMatch[1].replace(/\s+/g, '_') + '__c' : 'CustomObject__c';
            finalDeploymentInfo = {
                metadataType: 'CustomObject',
                objectApiName: objectName
            };
        }
        const type = finalDeploymentInfo.metadataType;
        let processedMetadata = cleanXml(metadataXml);

        await fs.ensureDir(mdapiDir);

        if (type === 'CustomObject') {
            console.log('Preparing to deploy CustomObject...');
            processedMetadata = postProcessXml(processedMetadata);
            const objectName = finalDeploymentInfo.objectApiName;
            await fs.ensureDir(path.join(mdapiDir, 'objects'));
            const objectFileName = `${objectName}.object-meta.xml`;
            const objectFilePath = path.join(mdapiDir, 'objects', objectFileName);
            await fs.writeFile(objectFilePath, processedMetadata);
            const packageXmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata"><types><members>${objectName}</members><name>CustomObject</name></types><version>60.0</version></Package>`;
            await fs.writeFile(path.join(mdapiDir, 'package.xml'), packageXmlContent);
        } else if (type === 'CustomField') {
            const standardObjectName = finalDeploymentInfo.objectApiName;
            console.log(`Preparing to deploy CustomFields to ${standardObjectName}...`);
            processedMetadata = convertCustomFieldToFields(processedMetadata);
            processedMetadata = cleanStandardObjectFieldMetadata(processedMetadata);
            const fieldMatches = processedMetadata.match(/<fields>[\s\S]*?<\/fields>/g);
            if (!fieldMatches) throw new Error('No valid field metadata blocks found after cleaning.');
            const fieldMembers = [];
            const objectFieldsDir = path.join(mdapiDir, 'objects', standardObjectName, 'fields');
            await fs.ensureDir(objectFieldsDir);
            for (const fieldMatch of fieldMatches) {
                const fullNameMatch = fieldMatch.match(/<fullName>([^<]+)<\/fullName>/);
                if (fullNameMatch) {
                    const fieldName = fullNameMatch[1];
                    fieldMembers.push(`${standardObjectName}.${fieldName}`);
                    const fieldFileName = `${fieldName}.field-meta.xml`;
                    const singleFieldXml = `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">${fieldMatch.replace(/<\/?fields>/g, '').trim()}</CustomField>`;
                    await fs.writeFile(path.join(objectFieldsDir, fieldFileName), singleFieldXml);
                }
            }
            if (fieldMembers.length === 0) throw new Error("Could not extract field members for package.xml.");
            const packageXmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata"><types><members>${fieldMembers.join('</members>\n<members>')}</members><name>CustomField</name></types><version>60.0</version></Package>`;
        await fs.writeFile(path.join(mdapiDir, 'package.xml'), packageXmlContent);
        } else {
            return res.status(400).json({ error: `Unsupported metadataType for deployment: ${type}` });
        }

        // --- [RESTORED] ASYNC DEPLOYMENT LOGIC ---
        deployJobs[jobId] = { status: "pending", result: null, steps: ['Deployment job created. Preparing metadata...'] };

        (async () => {
            try {
                deployJobs[jobId].steps.push(`Deploying to Salesforce org: ${SF_ORG_ALIAS}`);
                deployJobs[jobId].status = 'in-progress';
                console.log(`Executing deployment for job ${jobId} targeting org ${SF_ORG_ALIAS}`);

                const command = `sf project deploy start --metadata-dir "${mdapiDir}" --json --target-org ${SF_ORG_ALIAS}`;
                console.log(`DEBUG: Executing command: ${command}`);
                console.log(`DEBUG: Working directory: ${PROJECT_DIR}`);
                
                exec(command, { cwd: PROJECT_DIR }, (error, stdout, stderr) => {
                    console.log(`DEBUG: Command completed. Error: ${error ? 'YES' : 'NO'}`);
                    console.log(`DEBUG: stdout: ${stdout}`);
                    console.log(`DEBUG: stderr: ${stderr}`);
                    
                        if (error) {
                        console.error(`Exec error for job ${jobId}:`, stderr || error.message);
                        deployJobs[jobId].status = "failed";
                        deployJobs[jobId].result = { error: `Deployment command failed: ${error.message}`, details: stderr };
                        deployJobs[jobId].steps.push("Deployment failed. See results for details.");
                        return;
                    }
                    try {
                        const deployResult = JSON.parse(stdout);
                        if (deployResult.status === 0 && deployResult.result.status === 'Succeeded') {
                           deployJobs[jobId].status = "succeeded";
                           deployJobs[jobId].result = deployResult.result;
                           deployJobs[jobId].steps.push("Deployment successful!");
                        } else {
                           deployJobs[jobId].status = "failed";
                           deployJobs[jobId].result = deployResult.result || { error: "Deployment command reported a failure.", details: stdout };
                           deployJobs[jobId].steps.push("Deployment command reported a failure.");
                        }
                    } catch(parseError) {
                        console.error(`Error parsing deployment output for job ${jobId}: ${parseError}`);
                        deployJobs[jobId].status = "failed";
                        deployJobs[jobId].result = { error: "Failed to parse SF CLI output.", details: stdout };
                        deployJobs[jobId].steps.push("Error processing deployment result.");
                    } finally {
                        setTimeout(() => fs.remove(jobDir).catch(e => console.error(`Failed to cleanup temp dir ${jobDir}:`, e)), 30000); 
                    }
                });
            } catch (err) {
                console.error(`Async deployment process error for job ${jobId}:`, err.stack);
                deployJobs[jobId].status = "failed";
                deployJobs[jobId].result = { error: `Internal server error during deployment process: ${err.message}` };
                deployJobs[jobId].steps.push("Critical error during deployment execution.");
                fs.remove(jobDir).catch(e => console.error(`Failed to cleanup temp dir ${jobDir} on critical error:`, e));
            }
        })();

        res.json({ jobId, message: "Deployment started. Check status endpoint for progress." });

    } catch (err) {
        console.error("Deployment setup error:", err.stack);
        fs.remove(jobDir).catch(e => console.error(`Failed to cleanup temp dir ${jobDir} after setup error:`, e));
        res.status(500).json({ error: `An error occurred during deployment setup: ${err.message}` });
    }
});


// === [ADDED] JOB STATUS & HEALTHCHECK ENDPOINTS ===

// New endpoint to check the status of a deployment
app.get("/api/deployment/status/:jobId", (req, res) => {
    const { jobId } = req.params;
    const job = deployJobs[jobId];
    if (!job) {
        return res.status(404).json({ error: "Job not found." });
    }
    res.json(job);
});

// Standard health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ status: "healthy", timestamp: new Date() });
});

// === SERVER START ===
app.listen(PORT, () => {
    console.log(`AI Metadata Service running on http://localhost:${PORT}`);
    console.log(`Salesforce Project Directory: ${PROJECT_DIR}`);
    console.log(`Default SF Org Alias: ${SF_ORG_ALIAS}`);
    fs.ensureDirSync(TMP_DIR); // Ensure temp directory exists on startup
});