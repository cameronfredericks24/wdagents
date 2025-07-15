// metadataGenerators.js

function generateApprovalProcessXML({
  processName,
  objectName,
  label,
  allowedSubmitters = [],
  steps = [],
  globalEntryCriteria = null,
  globalEntryCriteriaFormula = "",
  initialActions = [],
  finalApprovalActions = [],
  finalRejectionActions = [],
  recallActions = [],
  finalApprovalRecordLock = true,
  finalRejectionRecordLock = true,
  recordEditability = "AdminOnly",
  showApprovalHistory = true,
  allowRecall = true,
  active = true
}) {
  // Process name validation and sanitization
  const safeProcessName = (processName || label || "Approval_Process").replace(/[^a-zA-Z0-9_]/g, "_");
  const safeObjectName = (objectName || "Custom_Object__c").replace(/[^a-zA-Z0-9_]/g, "_");
  
  // Allowed Submitters with enhanced validation
  const allowedSubmittersXml = generateAllowedSubmittersXml(allowedSubmitters);

  // Global Entry Criteria with support for complex conditions
  const globalEntryCriteriaXml = generateEntryCriteriaXml(globalEntryCriteria, globalEntryCriteriaFormula, "global");

  // Enhanced Steps XML with multi-criteria support
  const stepsXml = steps.map((step, index) => generateStepXml(step, index + 1)).join("\n");

  // Actions with enhanced support
  const actionsXml = generateActionsXml({
    initialActions,
    finalApprovalActions,
    finalRejectionActions,
    recallActions
  });

  // Record locking and visibility settings
  const settingsXml = generateSettingsXml({
    finalApprovalRecordLock,
    finalRejectionRecordLock,
    recordEditability,
    showApprovalHistory,
    allowRecall,
    active
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<ApprovalProcess xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>${label || safeProcessName}</label>
    <object>${safeObjectName}</object>
    <active>${active}</active>
    <allowRecall>${allowRecall}</allowRecall>
${allowedSubmittersXml}
    <approvalPageFields>
        <field>Name</field>
        <field>Owner</field>
    </approvalPageFields>
${globalEntryCriteriaXml}
${stepsXml}
${actionsXml}
${settingsXml}
</ApprovalProcess>`;
}

// Enhanced Allowed Submitters Generator
function generateAllowedSubmittersXml(allowedSubmitters) {
  if (!Array.isArray(allowedSubmitters) || allowedSubmitters.length === 0) {
    return `    <allowedSubmitters>
        <type>owner</type>
    </allowedSubmitters>`;
  }

  return allowedSubmitters.map(submitter => {
    const type = submitter.type || "owner";
    const submitterXml = submitter.submitter ? `        <submitter>${submitter.submitter}</submitter>` : "";
    return `    <allowedSubmitters>
${submitterXml}
        <type>${type}</type>
    </allowedSubmitters>`;
  }).join("\n");
}

// Enhanced Entry Criteria Generator with multi-criteria support
function generateEntryCriteriaXml(criteria, formula, context = "step") {
  if (formula && formula.trim()) {
    return `    <entryCriteria>
        <formula>${formula.trim()}</formula>
    </entryCriteria>`;
  }

  if (!criteria) return "";

  // Handle single criteria object
  if (typeof criteria === 'object' && !Array.isArray(criteria)) {
    if (criteria.field && criteria.operation && criteria.value !== undefined) {
      return `    <entryCriteria>
        <criteriaItems>
            <field>${criteria.field}</field>
            <operation>${criteria.operation}</operation>
            <value>${criteria.value}</value>
        </criteriaItems>
    </entryCriteria>`;
    }
  }

  // Handle array of criteria (multi-criteria)
  if (Array.isArray(criteria) && criteria.length > 0) {
    const criteriaItems = criteria.map(item => {
      if (typeof item === 'string') {
        return `            <field>${item}</field>
            <operation>equals</operation>
            <value>true</value>`;
      }
      if (typeof item === 'object' && item.field && item.operation && item.value !== undefined) {
        return `            <field>${item.field}</field>
            <operation>${item.operation}</operation>
            <value>${item.value}</value>`;
      }
      return null;
    }).filter(Boolean);

    if (criteriaItems.length > 0) {
      return `    <entryCriteria>
        <criteriaItems>
${criteriaItems.join("\n")}
        </criteriaItems>
    </entryCriteria>`;
    }
  }

  // Handle simple string criteria
  if (typeof criteria === 'string') {
    return `    <entryCriteria>
        <criteriaItems>
            <field>${criteria}</field>
            <operation>equals</operation>
            <value>true</value>
        </criteriaItems>
    </entryCriteria>`;
  }

  return "";
}

// Enhanced Step Generator with multi-criteria and advanced features
function generateStepXml(step, stepNumber) {
  const {
    name,
    label,
    approvers = [],
    entryCriteria = null,
    criteriaFormula = "",
    actions = [],
    allowDelegate = false,
    ifCriteriaNotMet = "GoToNextStep",
    whenMultipleApprovers = "FirstResponse",
    description = "",
    stepNumber: customStepNumber
  } = step;

  const stepName = name || `Step_${stepNumber}`;
  const stepLabel = label || `Approval Step ${stepNumber}`;

  // Generate approvers XML
  const approversXml = generateApproversXml(approvers);

  // Generate step entry criteria
  const stepEntryCriteriaXml = generateEntryCriteriaXml(entryCriteria, criteriaFormula, "step");

  // Generate step actions
  const stepActionsXml = generateStepActionsXml(actions);

  // Step options
  const stepOptionsXml = generateStepOptionsXml({
    allowDelegate,
    ifCriteriaNotMet,
    whenMultipleApprovers,
    description
  });

  return `    <approvalStep>
        <allowDelegate>${allowDelegate}</allowDelegate>
        <approvalActions>
${stepActionsXml}
        </approvalActions>
        <assignedApprover>
${approversXml}
        </assignedApprover>
${stepEntryCriteriaXml}
${stepOptionsXml}
        <label>${stepLabel}</label>
        <name>${stepName}</name>
    </approvalStep>`;
}

// Enhanced Approvers Generator
function generateApproversXml(approvers) {
  if (!Array.isArray(approvers) || approvers.length === 0) {
    return `            <approver>
                <type>user</type>
                <name>System Administrator</name>
            </approver>`;
  }

  return approvers.map(approver => {
    const { type, name, userHierarchyField, relatedUserField, queueName } = approver;
    
    switch (type) {
      case "user":
        return `            <approver>
                <type>user</type>
                <name>${name || "System Administrator"}</name>
            </approver>`;
      
      case "queue":
        return `            <approver>
                <type>queue</type>
                <name>${queueName || name || "Default Queue"}</name>
            </approver>`;
      
      case "userHierarchyField":
        return `            <approver>
                <type>userHierarchyField</type>
                <userHierarchyField>${userHierarchyField || "ManagerId"}</userHierarchyField>
            </approver>`;
      
      case "relatedUserField":
        return `            <approver>
                <type>relatedUserField</type>
                <name>${relatedUserField || name}</name>
                <userHierarchyField>${userHierarchyField || ""}</userHierarchyField>
            </approver>`;
      
      case "role":
        return `            <approver>
                <type>role</type>
                <name>${name}</name>
            </approver>`;
      
      case "roleAndSubordinates":
        return `            <approver>
                <type>roleAndSubordinates</type>
                <name>${name}</name>
            </approver>`;
      
      case "roleAndSubordinatesInternal":
        return `            <approver>
                <type>roleAndSubordinatesInternal</type>
                <name>${name}</name>
            </approver>`;
      
      default:
        return `            <approver>
                <type>user</type>
                <name>System Administrator</name>
            </approver>`;
    }
  }).join("\n");
}

// Enhanced Step Actions Generator
function generateStepActionsXml(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return `            <action>
                <name>Approval Step Action</name>
                <type>Task</type>
            </action>`;
  }

  return actions.map(action => {
    const { name, type = "Task", description = "", assignTo = "", dueDate = "" } = action;
    let actionXml = `            <action>
                <name>${name || "Approval Action"}</name>
                <type>${type}</type>`;
    
    if (description) actionXml += `\n                <description>${description}</description>`;
    if (assignTo) actionXml += `\n                <assignTo>${assignTo}</assignTo>`;
    if (dueDate) actionXml += `\n                <dueDate>${dueDate}</dueDate>`;
    
    actionXml += `\n            </action>`;
    return actionXml;
  }).join("\n");
}

// Enhanced Step Options Generator
function generateStepOptionsXml({ allowDelegate, ifCriteriaNotMet, whenMultipleApprovers, description }) {
  let optionsXml = "";
  
  if (ifCriteriaNotMet && ifCriteriaNotMet !== "GoToNextStep") {
    optionsXml += `        <ifCriteriaNotMet>${ifCriteriaNotMet}</ifCriteriaNotMet>\n`;
  }
  
  if (whenMultipleApprovers && whenMultipleApprovers !== "FirstResponse") {
    optionsXml += `        <whenMultipleApprovers>${whenMultipleApprovers}</whenMultipleApprovers>\n`;
  }
  
  if (description) {
    optionsXml += `        <description>${description}</description>\n`;
  }
  
  return optionsXml;
}

// Enhanced Actions Generator
function generateActionsXml({ initialActions, finalApprovalActions, finalRejectionActions, recallActions }) {
  const actionBlocks = [];
  
  if (Array.isArray(initialActions) && initialActions.length > 0) {
    actionBlocks.push(generateActionBlock(initialActions, "initialSubmissionActions"));
  }
  
  if (Array.isArray(finalApprovalActions) && finalApprovalActions.length > 0) {
    actionBlocks.push(generateActionBlock(finalApprovalActions, "finalApprovalActions"));
  }
  
  if (Array.isArray(finalRejectionActions) && finalRejectionActions.length > 0) {
    actionBlocks.push(generateActionBlock(finalRejectionActions, "finalRejectionActions"));
  }
  
  if (Array.isArray(recallActions) && recallActions.length > 0) {
    actionBlocks.push(generateActionBlock(recallActions, "recallActions"));
  }
  
  return actionBlocks.join("\n");
}

// Enhanced Action Block Generator
function generateActionBlock(actions, blockType) {
  const actionsXml = actions.map(action => {
    const { name, type = "FieldUpdate", description = "", field = "", value = "" } = action;
    let actionXml = `        <action>
            <name>${name || `${blockType} Action`}</name>
            <type>${type}</type>`;
    
    if (description) actionXml += `\n            <description>${description}</description>`;
    if (field) actionXml += `\n            <field>${field}</field>`;
    if (value !== undefined && value !== "") actionXml += `\n            <value>${value}</value>`;
    
    actionXml += `\n        </action>`;
    return actionXml;
  }).join("\n");

  return `    <${blockType}>
${actionsXml}
    </${blockType}>`;
}

// Enhanced Settings Generator
function generateSettingsXml({ finalApprovalRecordLock, finalRejectionRecordLock, recordEditability, showApprovalHistory, allowRecall, active }) {
  return `    <finalApprovalRecordLock>${finalApprovalRecordLock}</finalApprovalRecordLock>
    <finalRejectionRecordLock>${finalRejectionRecordLock}</finalRejectionRecordLock>
    <recordEditability>${recordEditability}</recordEditability>
    <showApprovalHistory>${showApprovalHistory}</showApprovalHistory>`;
}

function generateCustomObjectXML({ objectName, label }) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n    <label>${label}</label>\n    <pluralLabel>${label}s</pluralLabel>\n    <nameField>\n        <type>Text</type>\n        <label>${label} Name</label>\n    </nameField>\n    <deploymentStatus>Deployed</deploymentStatus>\n    <sharingModel>ReadWrite</sharingModel>\n</CustomObject>`;
}

function generateCustomFieldXML(field) {
  let type = (field.type || "").replace(/[.]/g, "").trim();
  type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  if (type === "Picklist" && Array.isArray(field.values)) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Picklist</type>\n    <valueSet>\n        <valueSetDefinition>\n            <sorted>false</sorted>\n${field.values.map((v) => `            <value>\n                <fullName>${v}</fullName>\n                <default>false</default>\n                <label>${v}</label>\n            </value>`).join("\n")}\n        </valueSetDefinition>\n    </valueSet>\n</CustomField>`;
  }
  if (type === "Multiselectpicklist" && Array.isArray(field.values)) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>MultiselectPicklist</type>\n    <valueSet>\n        <valueSetDefinition>\n            <sorted>false</sorted>\n${field.values.map((v) => `            <value>\n                <fullName>${v}</fullName>\n                <default>false</default>\n                <label>${v}</label>\n            </value>`).join("\n")}\n        </valueSetDefinition>\n    </valueSet>\n    <visibleLines>4</visibleLines>\n</CustomField>`;
  }
  if (type === "Checkbox") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Checkbox</type>\n    <defaultValue>false</defaultValue>\n</CustomField>`;
  }
  if (type === "Currency") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Currency</type>\n    <precision>18</precision>\n    <scale>2</scale>\n</CustomField>`;
  }
  if (type === "Number") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Number</type>\n    <precision>18</precision>\n    <scale>2</scale>\n</CustomField>`;
  }
  if (type === "Percent") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Percent</type>\n    <precision>3</precision>\n    <scale>2</scale>\n</CustomField>`;
  }
  if (type === "Text") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Text</type>\n    <length>120</length>\n</CustomField>`;
  }
  if (type === "Textarea") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>TextArea</type>\n    <length>255</length>\n</CustomField>`;
  }
  if (type === "Longtextarea") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>LongTextArea</type>\n    <length>32768</length>\n    <visibleLines>3</visibleLines>\n</CustomField>`;
  }
  if (type === "Email") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Email</type>\n</CustomField>`;
  }
  if (type === "Phone") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Phone</type>\n</CustomField>`;
  }
  if (type === "Url") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Url</type>\n</CustomField>`;
  }
  if (type === "Date") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Date</type>\n</CustomField>`;
  }
  if (type === "Datetime") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>DateTime</type>\n</CustomField>`;
  }
  if (type === "Time") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Time</type>\n</CustomField>`;
  }
  if (type === "Autonumber") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>AutoNumber</type>\n    <displayFormat>${field.displayFormat || "AUTO-{0000}"}</displayFormat>\n    <startingNumber>1</startingNumber>\n</CustomField>`;
  }
  if (type === "Encryptedtext") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>EncryptedText</type>\n    <length>175</length>\n    <maskChar>X</maskChar>\n    <maskType>all</maskType>\n</CustomField>`;
  }
  if (type === "Geolocation") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Geolocation</type>\n    <displayLocationInDecimal>true</displayLocationInDecimal>\n    <scale>6</scale>\n</CustomField>`;
  }
  // Lookup, MasterDetail (minimal, for demo)
  if (type === "Lookup") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Lookup</type>\n    <referenceTo>${field.referenceTo || "User"}</referenceTo>\n    <relationshipLabel>${field.label} Lookup</relationshipLabel>\n    <relationshipName>${field.label.replace(/\s+/g, "")}Lookup</relationshipName>\n</CustomField>`;
  }
  if (type === "Masterdetail") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>MasterDetail</type>\n    <referenceTo>${field.referenceTo || "User"}</referenceTo>\n    <relationshipLabel>${field.label} MasterDetail</relationshipLabel>\n    <relationshipName>${field.label.replace(/\s+/g, "")}MasterDetail</relationshipName>\n</CustomField>`;
  }
  // Fallback
  return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${field.fieldName}</fullName>\n    <label>${field.label}</label>\n    <type>Text</type>\n    <length>120</length>\n</CustomField>`;
}

module.exports = {
  generateApprovalProcessXML,
  generateCustomObjectXML,
  generateCustomFieldXML
};
 