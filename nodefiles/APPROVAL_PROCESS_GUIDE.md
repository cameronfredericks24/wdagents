# Enhanced Approval Process Generation Guide

## Overview

The enhanced approval process generator supports complex multi-criteria and multi-step approval workflows with advanced features like conditional logic, multiple approver types, and sophisticated action handling.

## Key Features

### 1. Multi-Criteria Support
- **Global Entry Criteria**: Conditions that must be met for the process to start
- **Step Entry Criteria**: Conditions for each approval step
- **Formula Support**: Complex logical expressions using Salesforce formulas
- **Multiple Criteria Items**: Combine multiple conditions in a single step

### 2. Multi-Step Workflows
- **Sequential Steps**: Steps that execute in order
- **Conditional Steps**: Steps that only execute based on criteria
- **Skip Logic**: Configure what happens when criteria aren't met
- **Multiple Approvers**: Different approver types per step

### 3. Advanced Approver Types
- **User**: Specific user by name
- **Queue**: Public group or queue
- **User Hierarchy**: Manager in user hierarchy
- **Related User Field**: User from a related field
- **Role**: Users with specific role
- **Role and Subordinates**: Role plus all subordinates
- **Role and Subordinates Internal**: Internal users only

### 4. Action Support
- **Initial Actions**: Execute when process starts
- **Step Actions**: Execute during each step
- **Final Approval Actions**: Execute when process is approved
- **Final Rejection Actions**: Execute when process is rejected
- **Recall Actions**: Execute when process is recalled

## Configuration Structure

```javascript
{
  processName: "Process_API_Name",
  objectName: "Object_API_Name__c",
  label: "Process Display Name",
  
  // Global entry criteria
  globalEntryCriteria: [...],
  globalEntryCriteriaFormula: "AND(condition1, condition2)",
  
  // Approval steps
  steps: [
    {
      name: "Step_API_Name",
      label: "Step Display Name",
      approvers: [...],
      entryCriteria: [...],
      criteriaFormula: "condition",
      actions: [...],
      allowDelegate: true,
      ifCriteriaNotMet: "GoToNextStep",
      whenMultipleApprovers: "FirstResponse"
    }
  ],
  
  // Actions
  initialActions: [...],
  finalApprovalActions: [...],
  finalRejectionActions: [...],
  recallActions: [...],
  
  // Settings
  finalApprovalRecordLock: true,
  finalRejectionRecordLock: true,
  recordEditability: "AdminOnly",
  showApprovalHistory: true,
  allowRecall: true,
  active: true
}
```

## Entry Criteria Types

### 1. Simple Field Criteria
```javascript
{
  field: "Status__c",
  operation: "equals",
  value: "Pending"
}
```

### 2. Multiple Criteria Items
```javascript
[
  {
    field: "Amount__c",
    operation: "greaterThan",
    value: "1000"
  },
  {
    field: "Department__c",
    operation: "equals",
    value: "IT"
  }
]
```

### 3. Formula Criteria
```javascript
criteriaFormula: "AND(Amount__c > 1000, Status__c = 'Pending', Department__c = 'IT')"
```

## Supported Operations

- `equals` - Field equals value
- `notEqual` - Field does not equal value
- `greaterThan` - Field is greater than value
- `lessThan` - Field is less than value
- `greaterOrEqual` - Field is greater than or equal to value
- `lessOrEqual` - Field is less than or equal to value
- `contains` - Field contains value (text fields)
- `notContain` - Field does not contain value (text fields)
- `startsWith` - Field starts with value (text fields)
- `endsWith` - Field ends with value (text fields)

## Approver Configuration

### 1. User Approver
```javascript
{
  type: "user",
  name: "john.doe@company.com"
}
```

### 2. Queue Approver
```javascript
{
  type: "queue",
  name: "Finance_Queue"
}
```

### 3. User Hierarchy Approver
```javascript
{
  type: "userHierarchyField",
  userHierarchyField: "ManagerId"
}
```

### 4. Related User Field Approver
```javascript
{
  type: "relatedUserField",
  name: "OwnerId",
  userHierarchyField: "ManagerId"
}
```

### 5. Role Approver
```javascript
{
  type: "role",
  name: "Finance Manager"
}
```

### 6. Role and Subordinates
```javascript
{
  type: "roleAndSubordinates",
  name: "VP Finance"
}
```

## Multiple Approver Behavior

- `FirstResponse` - Process continues when first approver responds
- `RequireAll` - All approvers must approve
- `RequireUnanimousApproval` - All approvers must approve (unanimous)

## Step Criteria Not Met Behavior

- `GoToNextStep` - Skip to next step
- `ApproveRecord` - Automatically approve
- `RejectRequest` - Automatically reject

## Action Types

### 1. Field Update Action
```javascript
{
  name: "Update Status",
  type: "FieldUpdate",
  field: "Status__c",
  value: "Approved"
}
```

### 2. Task Action
```javascript
{
  name: "Notify Manager",
  type: "Task",
  description: "Review required",
  assignTo: "Manager",
  dueDate: "TODAY"
}
```

### 3. Alert Action
```javascript
{
  name: "Send Alert",
  type: "Alert",
  description: "Approval notification"
}
```

## Example Scenarios

### 1. Simple Expense Approval
```javascript
{
  processName: "Expense_Approval",
  objectName: "Expense_Report__c",
  label: "Expense Report Approval",
  steps: [
    {
      name: "Manager_Approval",
      label: "Manager Approval",
      approvers: [
        { type: "userHierarchyField", userHierarchyField: "ManagerId" }
      ]
    },
    {
      name: "Finance_Approval",
      label: "Finance Approval",
      approvers: [
        { type: "queue", name: "Finance_Queue" }
      ],
      entryCriteria: {
        field: "Total_Amount__c",
        operation: "greaterThan",
        value: "1000"
      }
    }
  ]
}
```

### 2. Complex Purchase Order Approval
```javascript
{
  processName: "PO_Approval",
  objectName: "Purchase_Order__c",
  label: "Purchase Order Approval",
  globalEntryCriteria: [
    { field: "Status__c", operation: "equals", value: "Pending" },
    { field: "Total_Amount__c", operation: "greaterThan", value: "500" }
  ],
  steps: [
    {
      name: "Manager_Approval",
      label: "Manager Approval",
      approvers: [{ type: "userHierarchyField", userHierarchyField: "ManagerId" }],
      entryCriteria: { field: "Total_Amount__c", operation: "lessOrEqual", value: "5000" }
    },
    {
      name: "CFO_Approval",
      label: "CFO Approval",
      approvers: [{ type: "user", name: "cfo@company.com" }],
      entryCriteria: { field: "Total_Amount__c", operation: "greaterThan", value: "5000" }
    }
  ]
}
```

### 3. Formula-Based Approval
```javascript
{
  processName: "Vendor_Approval",
  objectName: "Vendor_Evaluation__c",
  label: "Vendor Evaluation Approval",
  globalEntryCriteriaFormula: "AND(Score__c < 70, Status__c = 'Pending')",
  steps: [
    {
      name: "HR_Approval",
      label: "HR Approval",
      approvers: [{ type: "queue", name: "HR_Queue" }],
      criteriaFormula: "AND(Score__c >= 50, Score__c < 70)"
    },
    {
      name: "CEO_Approval",
      label: "CEO Approval",
      approvers: [{ type: "user", name: "ceo@company.com" }],
      criteriaFormula: "Score__c < 60",
      ifCriteriaNotMet: "RejectRequest"
    }
  ]
}
```

## Best Practices

1. **Use Descriptive Names**: Use clear, descriptive names for processes and steps
2. **Validate Criteria**: Ensure criteria fields exist on the target object
3. **Test Formulas**: Verify complex formulas work as expected
4. **Consider Performance**: Limit the number of steps and criteria for better performance
5. **Document Logic**: Add descriptions to complex approval processes
6. **Handle Edge Cases**: Use `ifCriteriaNotMet` to handle unexpected scenarios

## Error Handling

The generator includes robust error handling for:
- Invalid field names
- Missing required parameters
- Malformed criteria
- Invalid approver types
- XML generation errors

## Testing

Use the provided test script to validate your approval process configurations:

```javascript
const { testApprovalProcess } = require('./testApprovalProcesses');

const myConfig = {
  // Your approval process configuration
};

const isValid = testApprovalProcess(myConfig, "My Process");
console.log(isValid ? "✅ Valid" : "❌ Invalid");
```

## Deployment

Generated approval processes are automatically deployed to Salesforce using SFDX:

```bash
sfdx force:source:deploy -p force-app/main/default/approvalProcesses/
```

## Troubleshooting

### Common Issues

1. **Field Not Found**: Ensure field API names are correct
2. **Invalid Formula**: Test formulas in Salesforce Formula Editor first
3. **Approver Not Found**: Verify user names, queue names, and role names
4. **Deployment Errors**: Check for validation errors in the generated XML

### Debug Tips

1. Enable debug logging in the backend
2. Review generated XML before deployment
3. Test with simple configurations first
4. Validate all field references exist 