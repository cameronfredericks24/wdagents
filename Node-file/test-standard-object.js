const fs = require('fs');
const path = require('path');
const { deploy } = require('./services/deployToSalesforce');

// Test function to add custom fields to Contact object
async function testContactFields() {
    console.log('🧪 Testing Contact object custom fields...');
    
    const contactFields = {
        object: "Contact",
        fields: [
            {
                name: "Hobby",
                label: "Hobby",
                type: "Picklist",
                length: null,
                precision: null,
                scale: null,
                defaultValue: null,
                picklistValues: ["Reading", "Gaming", "Sports", "Music", "Travel"]
            },
            {
                name: "AnnualIncome",
                label: "Annual Income",
                type: "Currency",
                length: null,
                precision: 18,
                scale: 2,
                defaultValue: null,
                picklistValues: []
            },
            {
                name: "PreferredContactMethod",
                label: "Preferred Contact Method",
                type: "Picklist",
                length: null,
                precision: null,
                scale: null,
                defaultValue: null,
                picklistValues: ["Email", "Phone", "SMS", "Mail"]
            }
        ],
        profileAccess: [
            {
                profile: "Standard_User",
                objectPermissions: {
                    allowRead: true,
                    allowCreate: true,
                    allowEdit: true,
                    allowDelete: false
                },
                fields: [
                    { field: "Hobby", readable: true, editable: true },
                    { field: "AnnualIncome", readable: true, editable: false },
                    { field: "PreferredContactMethod", readable: true, editable: true }
                ]
            }
        ],
        permissionSets: [
            {
                name: "Contact_Manager",
                label: "Contact Manager",
                objectPermissions: {
                    object: "Contact",
                    allowCreate: true,
                    allowRead: true,
                    allowEdit: true,
                    allowDelete: false
                },
                fieldPermissions: [
                    { field: "Contact.Hobby", readable: true, editable: true },
                    { field: "Contact.AnnualIncome", readable: true, editable: true },
                    { field: "Contact.PreferredContactMethod", readable: true, editable: true }
                ]
            }
        ],
        validationRules: []
    };

    try {
        await deploy(contactFields);
        console.log('✅ Contact fields test completed successfully!');
    } catch (error) {
        console.error('❌ Contact fields test failed:', error.message);
    }
}

// Test function to add custom fields to Account object
async function testAccountFields() {
    console.log('🧪 Testing Account object custom fields...');
    
    const accountFields = {
        object: "Account",
        fields: [
            {
                name: "IndustryType",
                label: "Industry Type",
                type: "Picklist",
                length: null,
                precision: null,
                scale: null,
                defaultValue: null,
                picklistValues: ["Technology", "Healthcare", "Finance", "Manufacturing", "Retail"]
            },
            {
                name: "AnnualRevenue",
                label: "Annual Revenue",
                type: "Currency",
                length: null,
                precision: 18,
                scale: 2,
                defaultValue: null,
                picklistValues: []
            },
            {
                name: "CustomerTier",
                label: "Customer Tier",
                type: "Picklist",
                length: null,
                precision: null,
                scale: null,
                defaultValue: null,
                picklistValues: ["Bronze", "Silver", "Gold", "Platinum"]
            }
        ],
        profileAccess: [
            {
                profile: "Standard_User",
                objectPermissions: {
                    allowRead: true,
                    allowCreate: true,
                    allowEdit: true,
                    allowDelete: false
                },
                fields: [
                    { field: "IndustryType", readable: true, editable: true },
                    { field: "AnnualRevenue", readable: true, editable: false },
                    { field: "CustomerTier", readable: true, editable: true }
                ]
            }
        ],
        permissionSets: [
            {
                name: "Account_Manager",
                label: "Account Manager",
                objectPermissions: {
                    object: "Account",
                    allowCreate: true,
                    allowRead: true,
                    allowEdit: true,
                    allowDelete: false
                },
                fieldPermissions: [
                    { field: "Account.IndustryType", readable: true, editable: true },
                    { field: "Account.AnnualRevenue", readable: true, editable: true },
                    { field: "Account.CustomerTier", readable: true, editable: true }
                ]
            }
        ],
        validationRules: []
    };

    try {
        await deploy(accountFields);
        console.log('✅ Account fields test completed successfully!');
    } catch (error) {
        console.error('❌ Account fields test failed:', error.message);
    }
}

// Main test function
async function runTests() {
    console.log('🚀 Starting standard object field tests...\n');
    
    // Test Contact fields
    await testContactFields();
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test Account fields
    await testAccountFields();
    
    console.log('\n🎉 All tests completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { testContactFields, testAccountFields, runTests }; 