const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const { parsePrompt } = require("./nodefiles/Aiparser");
const { deployToSalesforce } = require("./nodefiles/deploytosalesforce");
const { writeFileRecursive } = require("./nodefiles/utils");
const {
  generateCustomObjectXML,
  generateCustomFieldXML,
  generateApprovalProcessXML
} = require("./nodefiles/metadataGenerators");

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_KEY = process.env.MY_AGENT_API_KEY || "my-default-dev-key"; // Secure this in prod

const SAMPLE_PROMPTS = [
  "Create an object Invoice__c with fields for Invoice Number (AutoNumber), Amount (Currency), Due Date (Date), Status (Picklist: Draft, Sent, Paid, Overdue).",
  "Add fields Customer Reference (Text), Payment Terms (Picklist: Net 30, Net 60) to Account.",
  "Create an approval process for Purchase_Order__c that starts when Urgency__c = High and assigns to ProcurementQueue.",
  "Create a three-step approval on Vendor_Evaluation__c: Step 1 to Evaluator's Manager, Step 2 to HR, Step 3 to CEO only if Score__c < 70."
];

// --- RUNTIME DIRECTORY CHECK ---
if (require.main === module) {
  const expected = path.resolve(__dirname);
  const actual = process.cwd();
  if (expected !== actual) {
    console.error("\n[ERROR] Please run the backend using 'node index.js' from the project root, not from any subdirectory or nodefiles/index.js.\nCurrent working directory:", actual, "\nExpected:", expected, "\n");
    process.exit(1);
  }
}

// --- TRUST PROXY CONFIGURATION ---
// Fix for express-rate-limit X-Forwarded-For header error
app.set('trust proxy', 1);

// --- MIDDLEWARE SETUP ---
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 10 }));

// Helper to always resolve paths from the project root
const PROJECT_ROOT = __dirname;

// --- Enhanced Approval Process Validation ---
function validateApprovalProcess(details) {
  if (!details || typeof details !== "object") 
    return { valid: false, error: "Missing approval process details." };
  if (!details.objectName && !details.object) 
    return { valid: false, error: "Missing object name." };
  if (!details.label && !details.processName) 
    return { valid: false, error: "Missing process label." };
  if (!Array.isArray(details.steps) || details.steps.length < 1) 
    return { valid: false, error: "At least one approval step is required." };
  
  for (const [i, step] of details.steps.entries()) {
    if (!step.label || !step.name) 
      return { valid: false, error: `Step ${i + 1} missing label or name.` };
    if (!Array.isArray(step.approvers) || step.approvers.length < 1) 
      return { valid: false, error: `Step ${i + 1} missing approvers.` };
    
    for (const approver of step.approvers) {
      if (!approver.type) 
        return { valid: false, error: `Step ${i + 1} approver missing type.` };
      
      const type = approver.type;
      if (type === "user" && !approver.name) 
        return { valid: false, error: `Step ${i + 1} user approver missing name.` };
      if (type === "queue" && !approver.name) 
        return { valid: false, error: `Step ${i + 1} queue approver missing name.` };
      if (type === "relatedUserField" && (!approver.name || !approver.userHierarchyField)) 
        return { valid: false, error: `Step ${i + 1} relatedUserField missing field or hierarchy.` };
      if (type === "userHierarchyField" && !approver.userHierarchyField) 
        return { valid: false, error: `Step ${i + 1} userHierarchyField missing hierarchy field.` };
      if (type === "role" && !approver.name) 
        return { valid: false, error: `Step ${i + 1} role approver missing name.` };
      if (type === "roleAndSubordinates" && !approver.name) 
        return { valid: false, error: `Step ${i + 1} roleAndSubordinates approver missing name.` };
      if (type === "roleAndSubordinatesInternal" && !approver.name) 
        return { valid: false, error: `Step ${i + 1} roleAndSubordinatesInternal approver missing name.` };
      
      if (!["user", "queue", "relatedUserField", "userHierarchyField", "role", "roleAndSubordinates", "roleAndSubordinatesInternal"].includes(type)) 
        return { valid: false, error: `Step ${i + 1} has invalid approver type: ${type}` };
    }
    
    if (step.ifCriteriaNotMet && !["ApproveRecord", "RejectRequest", "GoToNextStep"].includes(step.ifCriteriaNotMet)) {
      return { valid: false, error: `Step ${i + 1} has invalid ifCriteriaNotMet value.` };
    }
    if (step.whenMultipleApprovers && !["FirstResponse", "RequireUnanimousApproval", "RequireAll"].includes(step.whenMultipleApprovers)) {
      return { valid: false, error: `Step ${i + 1} has invalid whenMultipleApprovers value.` };
    }
  }
  return { valid: true };
}

// --- MAIN ROUTE ---
app.post("/api/generate-metadata", async (req, res) => {
  const { prompt, apiKey } = req.body || {};

  // Input validation
  if (!prompt || !apiKey) {
    return res.status(400).json({ 
      error: "Missing prompt or apiKey.", 
      samples: SAMPLE_PROMPTS 
    });
  }

  // API key authentication
  if (apiKey !== AUTH_KEY) {
    return res.status(401).json({ 
      error: "Unauthorized request: invalid API key." 
    });
  }

  // Input sanitization
  const cleanPrompt = String(prompt)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  console.log('Received request:', JSON.stringify({ prompt: cleanPrompt, apiKey }));

  // Parse prompt
  const { action, details } = parsePrompt(cleanPrompt);

  if (!action || !details) {
    return res.status(400).json({ 
      error: "Could not understand the request.", 
      samples: SAMPLE_PROMPTS 
    });
  }

  console.log('[DEBUG] Parsed details:', JSON.stringify(details, null, 2));

  try {
    // Handle approval process generation
    if (action === "approval") {
      const validation = validateApprovalProcess(details);
      if (!validation.valid) {
        return res.status(400).json({ 
          error: "Invalid approval process structure", 
          details: validation.error 
        });
      }

      const xml = generateApprovalProcessXML(details);
      console.log('[DEBUG] Generated Approval Process XML (first 500 chars):', xml.slice(0, 500));
      
      const approvalDir = path.join(PROJECT_ROOT, 'force-app', 'main', 'default', 'approvalProcesses');
      const filePath = path.join(approvalDir, `${details.processName}.approvalProcess-meta.xml`);

      fs.mkdirSync(approvalDir, { recursive: true });
      writeFileRecursive(filePath, xml);
      console.log('[DEBUG] Wrote Approval Process XML to:', filePath);

      // Always deploy the entire approvalProcesses directory for reliability
      const deployPath = 'force-app/main/default/approvalProcesses/';
      try {
        const stdout = await deployToSalesforce(deployPath);
        return res.json({ 
          message: 'Approval process created and deployed!', 
          stdout 
        });
      } catch (err) {
        // Log the first 20 lines of the XML file if deployment fails
        try {
          const failedXml = fs.readFileSync(filePath, 'utf8');
          console.error('[DEPLOY ERROR] Failed XML (first 20 lines):', failedXml.split('\n').slice(0, 20).join('\n'));
        } catch (e) {}
        // Enhanced error handling for standard objects
        if (
          details.object &&
          ["Lead", "Account", "Opportunity", "Case", "Contact"].includes(details.object) &&
          /object invalid at this location/i.test(err)
        ) {
          return res.status(400).json({
            error: `Salesforce does not allow deploying approval processes for standard objects (like ${details.object}) via metadata in some orgs. Try setting sourceApiVersion to 43.0 in sfdx-project.json, or create the approval process in the Salesforce UI and retrieve it via source:retrieve.`
          });
        }
        console.error('[DEPLOY ERROR] Stack:', err.stack);
        return res.status(500).json({ 
          error: 'Error processing approval process deployment.', 
          details: err.message 
        });
      }
    }

    // Handle object and field generation
    if (action === "object") {
      const objectDir = path.join(PROJECT_ROOT, 'force-app', 'main', 'default', 'objects', details.objectName);
      const fieldsDir = path.join(objectDir, 'fields');
      fs.mkdirSync(fieldsDir, { recursive: true });

            const objectXml = generateCustomObjectXML(details);
      const objectFilePath = path.join(objectDir, `${details.objectName}.object-meta.xml`);
      writeFileRecursive(objectFilePath, objectXml);

      for (const field of details.fields || []) {
                    const fieldXml = generateCustomFieldXML(field);
        const fieldFilePath = path.join(fieldsDir, `${field.fieldName}.field-meta.xml`);
        writeFileRecursive(fieldFilePath, fieldXml);
      }

            const deployPath = `force-app/main/default/objects/${details.objectName}/`;
                const stdout = await deployToSalesforce(deployPath);
      return res.json({ 
        message: "Object and fields deployed successfully.", 
        stdout 
      });
    }

    return res.status(400).json({ 
      error: "Unknown action.", 
      samples: SAMPLE_PROMPTS 
    });

  } catch (err) {
    console.error('Error processing request:', err);
    return res.status(500).json({ 
      error: 'Error processing request.', 
      details: err.message 
    });
  }
});

// --- Fallback for Invalid Routes ---
app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`⚡️ Metadata Automation Agent running on http://localhost:${PORT}`);
  console.log(`🔐 API Key: ${AUTH_KEY}`);
  console.log(`🛡️  Security: Helmet + Rate Limiting enabled`);
}); 
