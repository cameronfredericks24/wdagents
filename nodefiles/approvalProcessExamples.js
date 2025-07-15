// approvalProcessExamples.js
// Comprehensive examples for multi-criteria and multi-step approval processes

const { generateApprovalProcessXML } = require('./metadataGenerators');

// Example 1: Simple Multi-Step Approval Process
const simpleMultiStepExample = {
  processName: "Expense_Report_Approval",
  objectName: "Expense_Report__c",
  label: "Expense Report Approval",
  steps: [
    {
      name: "Manager_Approval",
      label: "Manager Approval",
      approvers: [
        { type: "userHierarchyField", userHierarchyField: "ManagerId" }
      ],
      allowDelegate: true,
      whenMultipleApprovers: "FirstResponse"
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
  ],
  finalApprovalActions: [
    { name: "Update Status", type: "FieldUpdate", field: "Status__c", value: "Approved" }
  ],
  finalRejectionActions: [
    { name: "Update Status", type: "FieldUpdate", field: "Status__c", value: "Rejected" }
  ]
};

// Example 2: Complex Multi-Criteria Approval Process
const complexMultiCriteriaExample = {
  processName: "Purchase_Order_Approval",
  objectName: "Purchase_Order__c",
  label: "Purchase Order Approval",
  globalEntryCriteria: [
    {
      field: "Status__c",
      operation: "equals",
      value: "Pending Approval"
    },
    {
      field: "Total_Amount__c",
      operation: "greaterThan",
      value: "500"
    }
  ],
  steps: [
    {
      name: "Department_Manager",
      label: "Department Manager Approval",
      approvers: [
        { type: "userHierarchyField", userHierarchyField: "ManagerId" }
      ],
      entryCriteria: [
        {
          field: "Total_Amount__c",
          operation: "lessOrEqual",
          value: "5000"
        },
        {
          field: "Urgency__c",
          operation: "equals",
          value: "Normal"
        }
      ],
      ifCriteriaNotMet: "GoToNextStep"
    },
    {
      name: "Senior_Manager",
      label: "Senior Manager Approval",
      approvers: [
        { type: "userHierarchyField", userHierarchyField: "ManagerId" }
      ],
      entryCriteria: [
        {
          field: "Total_Amount__c",
          operation: "greaterThan",
          value: "5000"
        },
        {
          field: "Total_Amount__c",
          operation: "lessOrEqual",
          value: "25000"
        }
      ],
      actions: [
        { name: "Notify Senior Manager", type: "Task", description: "Review high-value purchase order" }
      ]
    },
    {
      name: "CFO_Approval",
      label: "CFO Approval",
      approvers: [
        { type: "user", name: "CFO User" }
      ],
      entryCriteria: {
        field: "Total_Amount__c",
        operation: "greaterThan",
        value: "25000"
      },
      whenMultipleApprovers: "RequireAll"
    }
  ]
};

// Example 3: Formula-Based Multi-Step Process
const formulaBasedExample = {
  processName: "Vendor_Evaluation_Approval",
  objectName: "Vendor_Evaluation__c",
  label: "Vendor Evaluation Approval",
  globalEntryCriteriaFormula: "AND(Score__c < 70, Status__c = 'Pending')",
  steps: [
    {
      name: "Evaluator_Manager",
      label: "Evaluator's Manager",
      approvers: [
        { type: "userHierarchyField", userHierarchyField: "ManagerId" }
      ],
      criteriaFormula: "Score__c < 50"
    },
    {
      name: "HR_Approval",
      label: "HR Approval",
      approvers: [
        { type: "queue", name: "HR_Queue" }
      ],
      criteriaFormula: "AND(Score__c >= 50, Score__c < 70)"
    },
    {
      name: "CEO_Approval",
      label: "CEO Approval",
      approvers: [
        { type: "user", name: "CEO" }
      ],
      criteriaFormula: "Score__c < 60",
      ifCriteriaNotMet: "RejectRequest"
    }
  ]
};

// Example 4: Role-Based Multi-Step Process
const roleBasedExample = {
  processName: "Contract_Approval",
  objectName: "Contract__c",
  label: "Contract Approval Process",
  steps: [
    {
      name: "Legal_Review",
      label: "Legal Review",
      approvers: [
        { type: "role", name: "Legal Manager" },
        { type: "roleAndSubordinates", name: "Legal Director" }
      ],
      entryCriteria: {
        field: "Contract_Type__c",
        operation: "equals",
        value: "Service Agreement"
      },
      whenMultipleApprovers: "RequireUnanimousApproval"
    },
    {
      name: "Finance_Review",
      label: "Finance Review",
      approvers: [
        { type: "role", name: "Finance Manager" }
      ],
      entryCriteria: [
        {
          field: "Contract_Value__c",
          operation: "greaterThan",
          value: "10000"
        }
      ]
    },
    {
      name: "Executive_Approval",
      label: "Executive Approval",
      approvers: [
        { type: "role", name: "VP Operations" },
        { type: "role", name: "VP Finance" }
      ],
      entryCriteria: {
        field: "Contract_Value__c",
        operation: "greaterThan",
        value: "100000"
      },
      whenMultipleApprovers: "RequireAll"
    }
  ]
};

// Example 5: Conditional Multi-Step with Actions
const conditionalWithActionsExample = {
  processName: "Travel_Request_Approval",
  objectName: "Travel_Request__c",
  label: "Travel Request Approval",
  initialActions: [
    { name: "Set Pending Status", type: "FieldUpdate", field: "Status__c", value: "Pending Approval" }
  ],
  steps: [
    {
      name: "Manager_Approval",
      label: "Manager Approval",
      approvers: [
        { type: "userHierarchyField", userHierarchyField: "ManagerId" }
      ],
      entryCriteria: {
        field: "Travel_Type__c",
        operation: "equals",
        value: "Domestic"
      },
      actions: [
        { name: "Notify Manager", type: "Task", description: "Review travel request" }
      ]
    },
    {
      name: "HR_Approval",
      label: "HR Approval",
      approvers: [
        { type: "queue", name: "HR_Travel_Queue" }
      ],
      entryCriteria: [
        {
          field: "Travel_Type__c",
          operation: "equals",
          value: "International"
        },
        {
          field: "Duration__c",
          operation: "greaterThan",
          value: "7"
        }
      ],
      actions: [
        { name: "HR Review Task", type: "Task", description: "Review international travel request" }
      ]
    },
    {
      name: "Finance_Approval",
      label: "Finance Approval",
      approvers: [
        { type: "queue", name: "Finance_Queue" }
      ],
      entryCriteria: {
        field: "Estimated_Cost__c",
        operation: "greaterThan",
        value: "5000"
      }
    }
  ],
  finalApprovalActions: [
    { name: "Approve Travel", type: "FieldUpdate", field: "Status__c", value: "Approved" },
    { name: "Create Expense Report", type: "Task", description: "Create expense report for approved travel" }
  ],
  finalRejectionActions: [
    { name: "Reject Travel", type: "FieldUpdate", field: "Status__c", value: "Rejected" },
    { name: "Notify Requester", type: "Task", description: "Notify requester of rejection" }
  ]
};

// Example 6: Complex Multi-Criteria with Multiple Approver Types
const complexMultiApproverExample = {
  processName: "Budget_Request_Approval",
  objectName: "Budget_Request__c",
  label: "Budget Request Approval",
  globalEntryCriteriaFormula: "AND(Status__c = 'Draft', Total_Amount__c > 0)",
  steps: [
    {
      name: "Department_Head",
      label: "Department Head Approval",
      approvers: [
        { type: "userHierarchyField", userHierarchyField: "ManagerId" },
        { type: "relatedUserField", name: "Department_Head__c" }
      ],
      entryCriteria: [
        {
          field: "Total_Amount__c",
          operation: "lessOrEqual",
          value: "10000"
        }
      ],
      whenMultipleApprovers: "FirstResponse"
    },
    {
      name: "Budget_Committee",
      label: "Budget Committee Review",
      approvers: [
        { type: "queue", name: "Budget_Committee_Queue" },
        { type: "role", name: "Budget Manager" }
      ],
      entryCriteria: [
        {
          field: "Total_Amount__c",
          operation: "greaterThan",
          value: "10000"
        },
        {
          field: "Total_Amount__c",
          operation: "lessOrEqual",
          value: "100000"
        }
      ],
      whenMultipleApprovers: "RequireUnanimousApproval"
    },
    {
      name: "Executive_Board",
      label: "Executive Board Approval",
      approvers: [
        { type: "role", name: "CEO" },
        { type: "role", name: "CFO" },
        { type: "role", name: "COO" }
      ],
      entryCriteria: {
        field: "Total_Amount__c",
        operation: "greaterThan",
        value: "100000"
      },
      whenMultipleApprovers: "RequireAll",
      ifCriteriaNotMet: "RejectRequest"
    }
  ]
};

// Function to generate and display examples
function generateExample(example, name) {
  console.log(`\n=== ${name} ===`);
  console.log('Input:', JSON.stringify(example, null, 2));
  console.log('\nGenerated XML:');
  console.log(generateApprovalProcessXML(example));
  console.log('\n' + '='.repeat(50));
}

// Export examples for use in other files
module.exports = {
  simpleMultiStepExample,
  complexMultiCriteriaExample,
  formulaBasedExample,
  roleBasedExample,
  conditionalWithActionsExample,
  complexMultiApproverExample,
  generateExample
};

// Usage examples:
// generateExample(simpleMultiStepExample, "Simple Multi-Step");
// generateExample(complexMultiCriteriaExample, "Complex Multi-Criteria");
// generateExample(formulaBasedExample, "Formula-Based");
// generateExample(roleBasedExample, "Role-Based");
// generateExample(conditionalWithActionsExample, "Conditional with Actions");
// generateExample(complexMultiApproverExample, "Complex Multi-Approver"); 