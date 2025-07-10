const axios = require('axios');

async function parsePrompt(prompt) {
    try {
        console.log('API Key present:', !!process.env.AI_API_KEY);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.AI_API_KEY}`;
        console.log('Sending request to Gemini API...');
        
        const enhancedPrompt = `Parse this prompt and return a JSON object with the following structure:
{
  "object": "ObjectName",
  "fields": [
    {
      "name": "fieldName",
      "label": "Field Label",
      "type": "FieldType",
      "length": 100,
      "precision": 18,
      "scale": 2,
      "defaultValue": false,
      "picklistValues": ["Option1", "Option2"]
    }
  ],
  "profileAccess": [
    {
      "profile": "ProfileName",
      "objectPermissions": { "allowRead": true, "allowCreate": true, "allowEdit": true, "allowDelete": false },
      "fields": [
        { "field": "FieldName", "readable": true, "editable": false }
      ]
    }
  ],
  "permissionSets": [
    {
      "name": "PermissionSetName",
      "label": "Permission Set Label",
      "objectPermissions": { "object": "ObjectName", "allowRead": true, "allowEdit": true },
      "fieldPermissions": [
        { "field": "ObjectName.FieldName", "readable": true, "editable": true }
      ]
    }
  ],
  "validationRules": [
    {
      "name": "ValidationRuleName",
      "errorMessage": "Error message to display",
      "errorConditionFormula": "Formula expression for validation"
    }
  ]
}

IMPORTANT GUIDELINES:
1. For standard objects (Contact, Account, Opportunity, Lead, Case, User), use the exact object name without __c suffix.
2. For custom objects, the system will automatically add __c suffix.
3. For each profile mentioned, include a profileAccess entry.
4. For each field that should have FLS, include a fields array with the field name and readable/editable booleans.
5. If a field is only visible, set readable: true, editable: false.
6. If a field is visible and editable, set both to true.
7. If a field is not visible, set both to false.
8. Only include fields in the fields array that should have FLS set for that profile.
9. If the prompt mentions permission sets, include a permissionSets array as shown above.
10. If the prompt mentions validation rules, include a validationRules array as shown above.
11. For standard objects, field permissions should reference the object name without __c (e.g., "Contact.FieldName__c").
12. For validation rule formulas, use simple field names (e.g., "Probability") - the system will automatically convert them to API names.
13. Use standard comparison operators: <, >, <=, >=, =, !=
14. Use logical operators: AND, OR, NOT (the system will convert them to Salesforce format)

Here's the prompt to parse: ${prompt}`;

        const response = await axios.post(url, {
            contents: [{
                parts: [{
                    text: enhancedPrompt
                }]
            }]
        });
        
        console.log('Received response from Gemini API');
        console.log('Response data:', JSON.stringify(response.data, null, 2));
        
        const result = response.data.candidates[0].content.parts[0].text;
        console.log('Extracted text:', result);
        
        // Try to parse the result as JSON, looking for any JSON-like string in the response
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON object found in the response');
        }
        
        const parsedResult = JSON.parse(jsonMatch[0]);
        console.log('Parsed JSON:', parsedResult);
        
        // Validate the parsed result
        if (!parsedResult.object || !Array.isArray(parsedResult.fields)) {
            throw new Error('Invalid response format: missing object name or fields array');
        }
        
        // Transform to the expected format
        const transformedResult = {
            object: parsedResult.object,
            fields: parsedResult.fields.map(field => ({
                name: field.name,
                label: field.label,
                type: field.type,
                length: field.length,
                precision: field.precision,
                scale: field.scale,
                defaultValue: field.defaultValue,
                picklistValues: field.picklistValues
            })),
            profileAccess: parsedResult.profileAccess || [],
            permissionSets: parsedResult.permissionSets || [],
            validationRules: parsedResult.validationRules || []
        };
        
        return transformedResult;
    } catch (error) {
        console.error('Error in parsePrompt:', error);
        if (error.response) {
            console.error('API Response Error:', JSON.stringify(error.response.data, null, 2));
        }
        throw new Error(`Failed to parse prompt: ${error.message}`);
    }
}

module.exports = parsePrompt;