// testApprovalProcesses.js
// Test script for enhanced approval process generation

const { generateApprovalProcessXML } = require('./metadataGenerators');
const {
  simpleMultiStepExample,
  complexMultiCriteriaExample,
  formulaBasedExample,
  roleBasedExample,
  conditionalWithActionsExample,
  complexMultiApproverExample
} = require('./approvalProcessExamples');

// Test function to validate XML structure
function validateApprovalProcessXML(xml) {
  const requiredElements = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ApprovalProcess xmlns="http://soap.sforce.com/2006/04/metadata">',
    '<label>',
    '<object>',
    '<active>',
    '<allowRecall>',
    '<allowedSubmitters>',
    '<approvalPageFields>',
    '</ApprovalProcess>'
  ];

  const missingElements = requiredElements.filter(element => !xml.includes(element));
  
  if (missingElements.length > 0) {
    console.error('❌ Missing required elements:', missingElements);
    return false;
  }

  // Check for proper step structure
  if (xml.includes('<approvalStep>')) {
    const stepElements = [
      '<allowDelegate>',
      '<approvalActions>',
      '<assignedApprover>',
      '<label>',
      '<name>'
    ];
    
    const missingStepElements = stepElements.filter(element => !xml.includes(element));
    if (missingStepElements.length > 0) {
      console.error('❌ Missing step elements:', missingStepElements);
      return false;
    }
  }

  console.log('✅ XML structure validation passed');
  return true;
}

// Test function to generate and validate approval process
function testApprovalProcess(example, name) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 TESTING: ${name}`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    const xml = generateApprovalProcessXML(example);
    
    console.log('\n📋 Input Configuration:');
    console.log(JSON.stringify(example, null, 2));
    
    console.log('\n📄 Generated XML:');
    console.log(xml);
    
    console.log('\n🔍 Validation Results:');
    const isValid = validateApprovalProcessXML(xml);
    
    if (isValid) {
      console.log('✅ Test PASSED');
    } else {
      console.log('❌ Test FAILED');
    }
    
    return isValid;
  } catch (error) {
    console.error('❌ Error generating approval process:', error.message);
    return false;
  }
}

// Advanced test scenarios
const advancedTestScenarios = [
  {
    name: "Multi-Criteria with Formula",
    config: {
      processName: "Advanced_Test_Process",
      objectName: "Test_Object__c",
      label: "Advanced Test Process",
      globalEntryCriteriaFormula: "AND(Status__c = 'Pending', Amount__c > 1000, Department__c = 'IT')",
      steps: [
        {
          name: "Step1",
          label: "First Approval",
          approvers: [
            { type: "user", name: "Manager1" },
            { type: "queue", name: "Queue1" }
          ],
          criteriaFormula: "Amount__c <= 5000",
          whenMultipleApprovers: "FirstResponse"
        },
        {
          name: "Step2",
          label: "Second Approval",
          approvers: [
            { type: "userHierarchyField", userHierarchyField: "ManagerId" }
          ],
          entryCriteria: [
            { field: "Amount__c", operation: "greaterThan", value: "5000" },
            { field: "Urgency__c", operation: "equals", value: "High" }
          ]
        }
      ]
    }
  },
  {
    name: "Complex Role-Based Process",
    config: {
      processName: "Role_Based_Process",
      objectName: "Complex_Object__c",
      label: "Role-Based Process",
      steps: [
        {
          name: "Legal_Review",
          label: "Legal Review",
          approvers: [
            { type: "role", name: "Legal Manager" },
            { type: "roleAndSubordinates", name: "Legal Director" }
          ],
          entryCriteria: { field: "Type__c", operation: "equals", value: "Contract" },
          whenMultipleApprovers: "RequireUnanimousApproval"
        },
        {
          name: "Finance_Review",
          label: "Finance Review",
          approvers: [
            { type: "role", name: "Finance Manager" },
            { type: "roleAndSubordinatesInternal", name: "Finance Director" }
          ],
          entryCriteria: { field: "Value__c", operation: "greaterThan", value: "10000" }
        }
      ]
    }
  },
  {
    name: "Action-Heavy Process",
    config: {
      processName: "Action_Heavy_Process",
      objectName: "Action_Object__c",
      label: "Action-Heavy Process",
      initialActions: [
        { name: "Set Status", type: "FieldUpdate", field: "Status__c", value: "In Review" },
        { name: "Create Task", type: "Task", description: "Review required" }
      ],
      steps: [
        {
          name: "Review_Step",
          label: "Review Step",
          approvers: [{ type: "user", name: "Reviewer" }],
          actions: [
            { name: "Update Status", type: "FieldUpdate", field: "Review_Status__c", value: "Under Review" },
            { name: "Notify Stakeholders", type: "Task", description: "Notify relevant stakeholders" }
          ]
        }
      ],
      finalApprovalActions: [
        { name: "Approve Record", type: "FieldUpdate", field: "Status__c", value: "Approved" },
        { name: "Send Approval Email", type: "Task", description: "Send approval notification" }
      ],
      finalRejectionActions: [
        { name: "Reject Record", type: "FieldUpdate", field: "Status__c", value: "Rejected" },
        { name: "Send Rejection Email", type: "Task", description: "Send rejection notification" }
      ]
    }
  }
];

// Run all tests
async function runAllTests() {
  console.log('🚀 Starting Approval Process Generation Tests\n');
  
  const testResults = [];
  
  // Test predefined examples
  const predefinedTests = [
    { example: simpleMultiStepExample, name: "Simple Multi-Step Process" },
    { example: complexMultiCriteriaExample, name: "Complex Multi-Criteria Process" },
    { example: formulaBasedExample, name: "Formula-Based Process" },
    { example: roleBasedExample, name: "Role-Based Process" },
    { example: conditionalWithActionsExample, name: "Conditional with Actions" },
    { example: complexMultiApproverExample, name: "Complex Multi-Approver Process" }
  ];
  
  for (const test of predefinedTests) {
    const result = testApprovalProcess(test.example, test.name);
    testResults.push({ name: test.name, passed: result });
  }
  
  // Test advanced scenarios
  for (const scenario of advancedTestScenarios) {
    const result = testApprovalProcess(scenario.config, scenario.name);
    testResults.push({ name: scenario.name, passed: result });
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 TEST SUMMARY');
  console.log(`${'='.repeat(60)}`);
  
  const passed = testResults.filter(r => r.passed).length;
  const total = testResults.length;
  
  testResults.forEach(result => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${result.name}`);
  });
  
  console.log(`\n🎯 Overall Result: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed! The approval process generator is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Please review the errors above.');
  }
}

// Export for use in other files
module.exports = {
  testApprovalProcess,
  validateApprovalProcessXML,
  runAllTests,
  advancedTestScenarios
};

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
} 