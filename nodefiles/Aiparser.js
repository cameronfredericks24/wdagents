/**
 * Bulletproof parser for Salesforce Approval Process and Object/Field prompts.
 * Handles multi-line, single-line, flexible order, optional/omitted sections, and is case/whitespace tolerant.
 * @param {string} prompt
 * @returns {object} { action: 'approval'|'object', details: {...} }
 */
function parsePrompt(prompt) {
  let action = "";
    let details = {};
  // --- Approval Process Creation ---
  if (/approval process|approval/i.test(prompt)) {
    action = "approval";
    // --- Robust Object Extraction: allow standard and custom objects, strip trailing punctuation ---
    let objectMatch = prompt.match(/for\s+([A-Za-z0-9_]+(__c)?)/i);
    if (!objectMatch)
      objectMatch = prompt.match(/on the?\s+([A-Za-z0-9_]+(__c)?)/i);
    if (!objectMatch)
      objectMatch = prompt.match(/on\s+([A-Za-z0-9_]+(__c)?)/i);
    if (!objectMatch)
      throw new Error("Could not parse object name for approval process.");
    let objectName = objectMatch[1];
    objectName = objectName.replace(/[:.,;\s]+$/, "");
    const processName = objectName + "_Approval";
    console.log('[AIPARSER DEBUG] Extracted objectName:', objectName, 'processName:', processName);
        let allowedSubmitters = [];
        let steps = [];
        let initialActions = [];
        let finalApprovalActions = [];
        let finalRejectionActions = [];
    let recallActions = [];
    let finalApprovalRecordLock = true;
    let finalRejectionRecordLock = true;
    let recordEditability = "AdminOnly";
    let showApprovalHistory = true;
    let globalEntryCriteria = "";
    let globalEntryCriteriaFormula = "";

    // --- Extract FieldUpdate actions for final approval/rejection ---
    const approvalFieldUpdateRegex = /set ([A-Za-z0-9_]+) to '([^']+)' on final approval/gi;
    let match;
    while ((match = approvalFieldUpdateRegex.exec(prompt)) !== null) {
      finalApprovalActions.push({
        type: "FieldUpdate",
        field: match[1],
        value: match[2],
        name: `Set ${match[1]} to ${match[2]}`
      });
    }
    const rejectionFieldUpdateRegex = /set ([A-Za-z0-9_]+) to '([^']+)' on rejection/gi;
    while ((match = rejectionFieldUpdateRegex.exec(prompt)) !== null) {
      finalRejectionActions.push({
        type: "FieldUpdate",
        field: match[1],
        value: match[2],
        name: `Set ${match[1]} to ${match[2]}`
      });
            }

    // --- Step Extraction ---
    let stepMatches = [
      ...prompt.matchAll(
        /step ?([0-9]+)[^a-zA-Z0-9]*((goes to|to|assigned to|route[ds]? to|approver is|approver:) ([^.,]+))( only if ([^.,]+))?( allow delegate)?( if criteria not met (ApproveRecord|RejectRequest|GoToNextStep))?( when multiple approvers (FirstResponse|RequireUnanimousApproval|RequireAll))?/gi
      )
    ];
    let stepNumbersUsed = new Set();
    if (stepMatches.length > 0) {
      for (let sm of stepMatches) {
        let stepNum = sm[1];
        let label = `Step${stepNum}`;
        let name = label;
        stepNumbersUsed.add(Number(stepNum));
        let assignee = sm[4] ? sm[4].trim() : "";
        console.log('[AIPARSER DEBUG] Step', stepNum, 'assignee:', assignee);
        let entryCriteria = sm[6] ? sm[6].trim() : "";
        // New logic: split assignee on 'if' to separate approver and criteria
        let ifSplit = assignee.split(/\s+if\s+/i);
        if (ifSplit.length > 1) {
          assignee = ifSplit[0].trim();
          entryCriteria = ifSplit[1].trim();
        }
        let criteriaFormula = "";
        // Criteria extraction for step
        let field = extractFieldApiName(entryCriteria);
        let op = mapOperation(entryCriteria);
        let valueMatch = entryCriteria.match(/(\d+\.?\d*)/);
        let value = valueMatch ? valueMatch[1] : "";
        if (
          /contains\s*\(/i.test(entryCriteria) ||
          /[=<>!]/.test(entryCriteria) ||
          /\bAND\b|\bOR\b|\bNOT\b/i.test(entryCriteria)
        ) {
          criteriaFormula = entryCriteria;
        } else if (field && op && value) {
          entryCriteria = { field, op, value };
                }
                let approvers = [];
        // --- Lookup field approver logic ---
        let lookupFieldMatch = assignee.match(/lookup field:?\s*([A-Za-z0-9_]+)/i);
        if (lookupFieldMatch) {
          // Not supported in Salesforce Approval Process metadata
          throw new Error(`Approver type 'relatedUserField' (lookup field: ${lookupFieldMatch[1]}) is not supported in Salesforce Approval Process metadata. Please use Manager, a static user, queue, or role instead.`);
        } else if (/managerid/i.test(assignee)) {
          approvers.push({ type: "userHierarchyField", userHierarchyField: "ManagerId" });
        } else if (/manager/i.test(assignee)) {
          approvers.push({ type: "userHierarchyField", userHierarchyField: "ManagerId" });
        } else if (/queue/i.test(assignee)) {
          approvers.push({ type: "queue", name: assignee.replace(/queue/i, "").trim() || "Queue" });
        } else if (/hr/i.test(assignee)) {
          approvers.push({ type: "user", name: "HR" });
        } else if (/owner/i.test(assignee)) {
          approvers.push({ type: "user", name: "Owner" });
        } else if (/user referenced in ([A-Za-z0-9_]+)/i.test(assignee)) {
          let refField = assignee.match(/user referenced in ([A-Za-z0-9_]+)/i)[1];
          approvers.push({ type: "relatedUserField", name: refField });
        } else if (/related user field ([A-Za-z0-9_]+)/i.test(assignee)) {
          let refField = assignee.match(/related user field ([A-Za-z0-9_]+)/i)[1];
          approvers.push({ type: "relatedUserField", name: refField });
        } else {
          approvers.push({ type: "user", name: assignee });
        }
        // Step options
        let allowDelegate = !!sm[8];
        let ifCriteriaNotMet = sm[10] ? sm[10] : undefined;
        let whenMultipleApprovers = sm[12] ? sm[12] : undefined;
        steps.push({
          label,
          name,
          approvers,
          entryCriteria,
          criteriaFormula,
          allowDelegate,
          ifCriteriaNotMet,
          whenMultipleApprovers
        });
            }
      // Sort steps numerically by label (StepX)
      steps.sort((a, b) => {
        let aNum = parseInt(a.label.replace(/\D/g, ""), 10);
        let bNum = parseInt(b.label.replace(/\D/g, ""), 10);
        return aNum - bNum;
      });
    } else {
      // --- Fallback: If no steps parsed, create a default step if approver is mentioned ---
      let assigneeMatch = prompt.match(/assign(ed)? to ([^.,]+)/i);
      let assignee = assigneeMatch ? assigneeMatch[2].trim() : "Manager";
      let approvers = [];
      let lookupFieldMatch = assignee.match(/lookup field:?\s*([A-Za-z0-9_]+)/i);
      if (lookupFieldMatch) {
        // Not supported in Salesforce Approval Process metadata
        throw new Error(`Approver type 'relatedUserField' (lookup field: ${lookupFieldMatch[1]}) is not supported in Salesforce Approval Process metadata. Please use Manager, a static user, queue, or role instead.`);
      } else if (/managerid/i.test(assignee)) {
        approvers.push({ type: "userHierarchyField", userHierarchyField: "ManagerId" });
      } else if (/manager/i.test(assignee)) {
        approvers.push({ type: "userHierarchyField", userHierarchyField: "ManagerId" });
      } else if (/queue/i.test(assignee)) {
        approvers.push({ type: "queue", name: assignee.replace(/queue/i, "").trim() || "Queue" });
      } else if (/hr/i.test(assignee)) {
        approvers.push({ type: "user", name: "HR" });
      } else if (/owner/i.test(assignee)) {
        approvers.push({ type: "user", name: "Owner" });
      } else if (/user referenced in ([A-Za-z0-9_]+)/i.test(assignee)) {
        let refField = assignee.match(/user referenced in ([A-Za-z0-9_]+)/i)[1];
        approvers.push({ type: "relatedUserField", name: refField });
      } else if (/related user field ([A-Za-z0-9_]+)/i.test(assignee)) {
        let refField = assignee.match(/related user field ([A-Za-z0-9_]+)/i)[1];
        approvers.push({ type: "relatedUserField", name: refField });
      } else {
        approvers.push({ type: "user", name: assignee });
      }
      steps = [
        {
          label: "Step1",
          name: "Step1",
          approvers,
          entryCriteria: globalEntryCriteria
        }
      ];
    }
    // --- Default allowedSubmitters if empty ---
    if (!allowedSubmitters || allowedSubmitters.length === 0) {
      allowedSubmitters = [{ type: "owner" }];
        }
        details = {
            processName,
            objectName,
            label: processName,
            object: objectName,
            allowedSubmitters,
            steps,
            globalEntryCriteria,
      globalEntryCriteriaFormula,
            initialActions,
            finalApprovalActions,
      finalRejectionActions,
      recallActions,
      finalApprovalRecordLock,
      finalRejectionRecordLock,
      recordEditability,
      showApprovalHistory
        };
    console.log(
      "Aiparser.js parsed approval process:",
      JSON.stringify(details, null, 2)
    );
    return { action, details };
    }
    // --- Object/Field Creation ---
  else if (/create|add|object|field/i.test(prompt)) {
    // --- Object Creation ---
    let createObjectMatch = prompt.match(
      /create (an? )?(object )?([A-Za-z0-9_]+(__c)?)( object)? with fields?:? (.+)/i
    );
    if (!createObjectMatch)
      createObjectMatch = prompt.match(
        /create ([A-Za-z0-9_]+(__c)?) with fields?:? (.+)/i
      );
    if (!createObjectMatch)
      createObjectMatch = prompt.match(
        /create ([A-Za-z0-9_]+(__c)?) object with (.+)/i
      );
    if (createObjectMatch) {
      action = "object";
      const objectName = createObjectMatch[3] || createObjectMatch[1];
      const label = objectName.replace(/__c$/, "").replace(/_/g, " ");
      let fieldsStr =
        createObjectMatch[6] || createObjectMatch[3] || createObjectMatch[2];
      // Remove leading 'for ' if present
      fieldsStr = fieldsStr.replace(/^for\s+/i, "");
      // Smart split on top-level commas and 'and', not inside parentheses
      function smartSplitFields(str) {
        const result = [];
        let current = "";
        let depth = 0;
        for (let i = 0; i < str.length; i++) {
          const c = str[i];
          if (c === "(") depth++;
          if (c === ")") depth--;
          // Only split on comma or ' and' if not inside parentheses
          if (
            depth === 0 &&
            ((c === "," && str[i + 1] !== ")") ||
              str.slice(i, i + 4).toLowerCase() === " and")
          ) {
            if (c === ",") {
              result.push(current.trim());
              current = "";
            } else if (str.slice(i, i + 4).toLowerCase() === " and") {
              result.push(current.trim());
              current = "";
              i += 3;
            }
          } else {
            current += c;
          }
        }
        if (current.trim()) result.push(current.trim());
        return result;
      }
      const fieldDefs = smartSplitFields(fieldsStr);
        const fields = [];
      for (let def of fieldDefs) {
        // Picklist with values: Loyality (Picklist: High, Medium, Low)
        let picklistMatch = def.match(/^(.+?)\s*\(\s*Picklist\s*:\s*([^)]+)\)/i);
        if (picklistMatch) {
          let fieldName = picklistMatch[1].trim();
          let values = picklistMatch[2]
            .split(/,|;/)
            .map(v => v.trim())
            .filter(Boolean);
          let label = fieldName.length > 40 ? fieldName.slice(0, 40) : fieldName;
          let apiFieldName = fieldName
            .replace(/[^A-Za-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "");
          if (!apiFieldName.toLowerCase().endsWith("__c")) apiFieldName += "__c";
          if (apiFieldName.length > 40) {
            apiFieldName = apiFieldName.replace(/__c$/, "").slice(0, 37) + "__c";
          }
          fields.push({
            fieldName: apiFieldName,
            label: label,
            type: "Picklist",
            values
          });
          continue; // Skip rest of matchers
        }
        // Patterns: Name (Type), Name - Type, Name: Type, Name of type Type, Name (Lookup to X), Name (Formula)
        let parenMatch = def.match(/^(.+?)\s*\(([^)]+)\)$/i);
        let dashMatch = def.match(/^(.+?)\s*-\s*([A-Za-z0-9_ ]+)$/i);
        let colonMatch = def.match(/^(.+?)\s*:\s*([A-Za-z0-9_ ]+)$/i);
        let ofTypeMatch = def.match(/^(.+?) of type ([A-Za-z0-9_ ]+)$/i);
        let fieldName, type, refTo;
        if (parenMatch) {
          fieldName = parenMatch[1].trim();
          type = parenMatch[2].trim();
          // Lookup to X
          let lookupMatch = type.match(/^lookup to ([A-Za-z0-9_]+)$/i);
          if (lookupMatch) {
            type = "Lookup";
            refTo = lookupMatch[1];
          }
          // Formula
          if (/formula/i.test(type)) {
            type = "Formula";
          }
        } else if (dashMatch) {
          fieldName = dashMatch[1].trim();
          type = dashMatch[2].trim();
        } else if (colonMatch) {
          fieldName = colonMatch[1].trim();
          type = colonMatch[2].trim();
        } else if (ofTypeMatch) {
          fieldName = ofTypeMatch[1].trim();
          type = ofTypeMatch[2].trim();
        } else {
          // Fallback: treat as Text
          fieldName = def.trim();
          type = "Text";
        }
        type = type.replace(/[.]/g, "").trim();
        type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
        let apiFieldName = fieldName
          .replace(/[^A-Za-z0-9]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "");
        if (!apiFieldName.toLowerCase().endsWith("__c")) apiFieldName += "__c";
        // Ensure field name doesn't exceed 40 characters (Salesforce limit)
        if (apiFieldName.length > 40) {
          // Remove __c suffix, truncate, then add it back
          if (apiFieldName.toLowerCase().endsWith("__c")) {
            apiFieldName = apiFieldName.slice(0, -3);
          }
          apiFieldName = apiFieldName.slice(0, 37) + "__c";
        }
        let fieldObj = { fieldName: apiFieldName, label: fieldName, type };
        if (type === "Lookup" && refTo) fieldObj.referenceTo = refTo;
        fields.push(fieldObj);
      }
      details = { objectName, label, fields };
      console.log(
        "Aiparser.js parsed object/fields:",
        JSON.stringify(details, null, 2)
      );
      return { action, details };
    }
    // --- Add Fields to Existing Object ---
    let addFieldsMatch = prompt.match(
      /add (fields?|a field) (.+?) to ([A-Za-z0-9_]+(__c)?)/i
    );
    if (!addFieldsMatch)
      addFieldsMatch = prompt.match(/add (.+?) to ([A-Za-z0-9_]+(__c)?)/i);
    if (addFieldsMatch) {
      action = "object";
      // Extract the object name as the last word after 'to' in the prompt
      let objectName = null;
      let fieldsStr = null;
      const toMatches = [...prompt.matchAll(/to\s+([A-Za-z0-9_]+(__c)?)/gi)];
      if (toMatches.length > 0) {
        objectName = toMatches[toMatches.length - 1][1];
        // Extract fields as everything before the last 'to <ObjectName>'
        fieldsStr = prompt.substring(0, toMatches[toMatches.length - 1].index).replace(/^add (fields?|a field) /i, "");
      }
      // Validate objectName
      if (!objectName || objectName.toLowerCase() === 'undefined' || objectName.toLowerCase() === 'null' || objectName.toLowerCase() === 'field' || objectName.toLowerCase() === 'type') {
        throw new Error("Could not parse a valid object name for field addition. Please use a prompt like 'Add fields ... to Account'.");
      }
      objectName = String(objectName).replace(/[^A-Za-z0-9_]/g, "");
      console.log("[AIPARSER DEBUG] Extracted objectName:", objectName);
      console.log("[AIPARSER DEBUG] Raw fieldsStr:", fieldsStr);
      const label = objectName.replace(/__c$/, "").replace(/_/g, " ");
      // --- Enhanced Field Extraction ---
      // 1. Try to match Field: X, Type: Y, Label: Z, Values: ...
      const fieldPattern = /Field:\s*([^,]+),\s*Type:\s*([^,]+)(?:,\s*Label:\s*([^,]+))?(?:,\s*Values?:\s*([^,]+(?:,[^,]+)*))?/gi;
      let fields = [];
      let match;
      let matchedAny = false;
      while ((match = fieldPattern.exec(fieldsStr)) !== null) {
        matchedAny = true;
        let fieldName = match[1].trim();
        let type = match[2].trim();
        let label = match[3] ? match[3].trim() : fieldName;
        let values = match[4] ? match[4].split(/,\s*/).map(v => v.trim()).filter(Boolean) : undefined;
        let apiFieldName = fieldName
          .replace(/[^A-Za-z0-9]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "");
        if (!apiFieldName.toLowerCase().endsWith("__c")) apiFieldName += "__c";
        if (apiFieldName.length > 40) {
          if (apiFieldName.toLowerCase().endsWith("__c")) {
            apiFieldName = apiFieldName.slice(0, -3);
          }
          apiFieldName = apiFieldName.slice(0, 37) + "__c";
        }
        let fieldObj = { fieldName: apiFieldName, label, type: type.charAt(0).toUpperCase() + type.slice(1).toLowerCase() };
        if (fieldObj.type === "Picklist" && values) fieldObj.values = values;
        if (/lookup/i.test(type) && values && values.length === 1) fieldObj.referenceTo = values[0];
        console.log("[AIPARSER DEBUG] Parsed field object:", fieldObj);
        fields.push(fieldObj);
      }
      // 2. If not matched, fallback to classic logic (e.g., Value (Picklist: ...))
      if (!matchedAny) {
        function smartSplitFields(str) {
          const result = [];
          let current = "";
          let depth = 0;
          for (let i = 0; i < str.length; i++) {
            const c = str[i];
            if (c === "(") depth++;
            if (c === ")") depth--;
            if (
              depth === 0 &&
              ((c === "," && str[i + 1] !== ")") ||
                str.slice(i, i + 4).toLowerCase() === " and")
            ) {
              if (c === ",") {
                result.push(current.trim());
                current = "";
              } else if (str.slice(i, i + 4).toLowerCase() === " and") {
                result.push(current.trim());
                current = "";
                i += 3;
              }
            } else {
              current += c;
            }
          }
          if (current.trim()) result.push(current.trim());
          return result;
        }
        const fieldDefs = smartSplitFields(fieldsStr);
            for (let def of fieldDefs) {
          // Picklist with values: Value (Picklist: High, Medium, Low)
          let picklistMatch = def.match(/^(.+?)\s*\(\s*Picklist\s*:\s*([^)]+)\)/i);
                if (picklistMatch) {
                    let fieldName = picklistMatch[1].trim();
            let values = picklistMatch[2]
              .split(/,|;/)
              .map(v => v.trim())
              .filter(Boolean);
            let label = fieldName.length > 40 ? fieldName.slice(0, 40) : fieldName;
            let apiFieldName = fieldName
              .replace(/[^A-Za-z0-9]/g, "_")
              .replace(/_+/g, "_")
              .replace(/^_|_$/g, "");
            if (!apiFieldName.toLowerCase().endsWith("__c")) apiFieldName += "__c";
            if (apiFieldName.length > 40) {
              apiFieldName = apiFieldName.replace(/__c$/, "").slice(0, 37) + "__c";
            }
            let fieldObj = {
              fieldName: apiFieldName,
              label: label,
              type: "Picklist",
              values
            };
            console.log("[AIPARSER DEBUG] Parsed field object:", fieldObj);
            fields.push(fieldObj);
                    continue;
                }
          // Lookup: Account Manager (Lookup to User)
          let lookupMatch = def.match(/^(.+?)\s*\(\s*Lookup to ([^)]+)\)/i);
          if (lookupMatch) {
            let fieldName = lookupMatch[1].trim();
            let refTo = lookupMatch[2].trim();
            let label = fieldName.length > 40 ? fieldName.slice(0, 40) : fieldName;
            let apiFieldName = fieldName
              .replace(/[^A-Za-z0-9]/g, "_")
              .replace(/_+/g, "_")
              .replace(/^_|_$/g, "");
            if (!apiFieldName.toLowerCase().endsWith("__c")) apiFieldName += "__c";
            if (apiFieldName.length > 40) {
              apiFieldName = apiFieldName.replace(/__c$/, "").slice(0, 37) + "__c";
            }
            let fieldObj = {
              fieldName: apiFieldName,
              label: label,
              type: "Lookup",
              referenceTo: refTo
            };
            console.log("[AIPARSER DEBUG] Parsed field object:", fieldObj);
            fields.push(fieldObj);
                    continue;
                }
          // Patterns: Name (Type), Name - Type, Name: Type, Name of type Type, Name (Formula)
          let parenMatch = def.match(/^(.+?)\s*\(([^)]+)\)$/i);
          let dashMatch = def.match(/^(.+?)\s*-\s*([A-Za-z0-9_ ]+)$/i);
          let colonMatch = def.match(/^(.+?)\s*:\s*([A-Za-z0-9_ ]+)$/i);
          let ofTypeMatch = def.match(/^(.+?) of type ([A-Za-z0-9_ ]+)$/i);
          let fieldName, type, refTo;
          if (parenMatch) {
            fieldName = parenMatch[1].trim();
            type = parenMatch[2].trim();
            // Formula
            if (/formula/i.test(type)) {
              type = "Formula";
            }
          } else if (dashMatch) {
            fieldName = dashMatch[1].trim();
            type = dashMatch[2].trim();
          } else if (colonMatch) {
            fieldName = colonMatch[1].trim();
            type = colonMatch[2].trim();
          } else if (ofTypeMatch) {
            fieldName = ofTypeMatch[1].trim();
            type = ofTypeMatch[2].trim();
          } else {
            fieldName = def.trim();
            type = "Text";
          }
          type = type.replace(/[.]/g, "").trim();
                    type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
          let apiFieldName = fieldName
            .replace(/[^A-Za-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "");
          if (!apiFieldName.toLowerCase().endsWith("__c")) apiFieldName += "__c";
          if (apiFieldName.length > 40) {
            if (apiFieldName.toLowerCase().endsWith("__c")) {
              apiFieldName = apiFieldName.slice(0, -3);
            }
            apiFieldName = apiFieldName.slice(0, 37) + "__c";
          }
          let fieldObj = { fieldName: apiFieldName, label: fieldName, type };
          if (type === "Lookup" && refTo) fieldObj.referenceTo = refTo;
          console.log("[AIPARSER DEBUG] Parsed field object:", fieldObj);
          fields.push(fieldObj);
            }
        }
        details = { objectName, label, fields };
      console.log(
        "Aiparser.js parsed object/fields:",
        JSON.stringify(details, null, 2)
      );
      return { action, details };
    }
    // fallback to previous logic if needed
    }
    return { action, details };
}

// Helper: Map natural language to Salesforce API operation
function mapOperation(nl) {
  nl = nl.toLowerCase();
  if (nl.includes('greater than or equal')) return 'greaterOrEqual';
  if (nl.includes('less than or equal')) return 'lessOrEqual';
  if (nl.includes('greater than')) return 'greaterThan';
  if (nl.includes('less than')) return 'lessThan';
  if (nl.includes('not equal') || nl.includes('does not equal')) return 'notEqual';
  if (nl.includes('equals') || nl.includes('equal to') || nl.includes('is')) return 'equals';
  return 'equals';
}

// Helper: Extract field API name from natural language
function extractFieldApiName(str) {
  // Try to match known field names (improve as needed)
  const knownFields = ['Amount', 'Status', 'StageName', 'OwnerId', 'ManagerId', 'Priority', 'Type', 'Name'];
  for (const f of knownFields) {
    if (str.toLowerCase().includes(f.toLowerCase())) return f;
  }
  // Fallback: take first word
  return str.split(' ')[0];
}

module.exports = { parsePrompt };
