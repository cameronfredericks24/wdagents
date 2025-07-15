# Node.js Salesforce Automation Agent

This folder contains a modular Node.js Express server for automating Salesforce object/field creation and approval process deployment, plus a Lightning Web Component (LWC) UI for natural language-driven automation.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Ensure you have the Salesforce CLI (`sfdx`) installed and authenticated to your org.
3. **Run the server from the project root:**
   ```
   node index.js
   ```
   **Do NOT run `node nodefiles/index.js`. Always use the project root entry point.**
4. (Optional) Use [ngrok](https://ngrok.com/) to expose your local server for public access.
   - Your current ngrok link: `https://3cc3-2405-201-d022-3150-8ccc-33b4-e21-edfa.ngrok-free.app`

## API Endpoint

### POST `/api/generate-metadata`

- **Body:**
  ```json
  {
    "prompt": "Describe your object/fields or approval process in plain English",
    "apiKey": "YOUR_AI_STUDIO_API_KEY"
  }
  ```
- **Example endpoint:**
  `https://3cc3-2405-201-d022-3150-8ccc-33b4-e21-edfa.ngrok-free.app/api/generate-metadata`
- **Response:**
  - Success:
    ```json
    {
      "message": "Deployment successful!",
      "details": {
        "objectName": "Travel_Request__c",
        "label": "Travel Request",
        "fields": [
          {
            "fieldName": "Employee_Name__c",
            "label": "Employee Name",
            "type": "Text"
          },
          {
            "fieldName": "Destination__c",
            "label": "Destination",
            "type": "Text"
          },
          { "fieldName": "Date__c", "label": "Date", "type": "Date" },
          { "fieldName": "Amount__c", "label": "Amount", "type": "Currency" },
          { "fieldName": "Status__c", "label": "Status", "type": "Picklist" }
        ],
        "steps": [
          {
            "label": "Step 1",
            "approvers": [{ "name": "Manager", "type": "User" }],
            "entryCriteria": "Amount > 2000"
          },
          {
            "label": "Step 2",
            "approvers": [{ "name": "Finance", "type": "User" }],
            "entryCriteria": "Amount > 5000"
          }
        ]
      },
      "stdout": "...sfdx output..."
    }
    ```
  - Error:
    ```json
    { "error": "Error message", "details": "Stack trace or details" }
    ```

## How it works

- Parses the prompt to determine if you want to create an object/field or automate an approval process.
- Generates the appropriate Salesforce metadata XML files.
- Writes files to the correct Salesforce DX folders.
- Automatically deploys the changes to your org using SFDX.
- Returns a detailed response with object/field/approval process info for UI display.

## File Structure

- `Aiparser.js` — Parses prompts and extracts intent/details.
- `metadataGenerators.js` — Generates Salesforce metadata XML for objects, fields, and approval processes.
- `deploytosalesforce.js` — Handles SFDX deployments.
- `utils.js` — File writing utilities.
- `index.js` — Main Express server (project root entry point).
- `templates/` — Template helpers for validation.

## LWC UI (Lightning Web Component)

- Located in `force-app/main/default/lwc/salesforceBot/`.
- Lets users describe objects, fields, or approval processes in natural language.
- Shows a spinner while processing, then displays a success/error message and a detailed card with the created object, fields, and approval steps.
- Example prompts:
  - "Create an object Travel_Request__c with fields for Employee Name (Text), Destination (Text), Date (Date), Amount (Currency), Status (Picklist: New, Submitted, Approved, Rejected)."
  - "Add fields Travel Date (Date) and Budget (Currency) to Opportunity."
  - "Create an approval process on Expense_Report__c that starts when Total_Amount__c > 1000 and assigns to the submitter's manager."

## Integration

- Connect your LWC or any HTTP client to the `/api/generate-metadata` endpoint.
- Use ngrok for public access if needed.

## Support

- Ensure your Salesforce DX project is set up and authenticated.
- For advanced prompt parsing, connect `Aiparser.js` to your AI Studio API.

--- 
