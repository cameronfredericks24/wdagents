# Adding Custom Fields to Standard Salesforce Objects

## Overview
Your system supports adding custom fields to existing standard Salesforce objects like Contact, Account, Opportunity, Lead, Case, and more. This guide provides proper prompts and best practices.

## Supported Standard Objects
- Contact
- Account  
- Opportunity
- Lead
- Case
- User
- Profile
- Role
- Campaign
- Asset
- Contract
- Order
- Product2
- Pricebook2

## Prompt Templates

### 1. Basic Custom Fields Addition

**Template:**
```
Add custom fields to the [ObjectName] object with the following specifications:

Object Name: [ObjectName]
Fields:
Name: [FieldName], Label: [FieldLabel], Type: [FieldType], [Additional Properties]

Field Level Security (Profile Access):
Profile: [ProfileName]
Fields:
field: [FieldName], readable: [true/false], editable: [true/false]
```

**Example:**
```
Add custom fields to the Contact object with the following specifications:

Object Name: Contact
Fields:
Name: Hobby, Label: Hobby, Type: Picklist, Picklist Values: ["Reading", "Gaming", "Sports", "Music", "Travel"]
Name: AnnualIncome, Label: Annual Income, Type: Currency, Precision: 18, Scale: 2
Name: PreferredContactMethod, Label: Preferred Contact Method, Type: Picklist, Picklist Values: ["Email", "Phone", "SMS", "Mail"]

Field Level Security (Profile Access):
Profile: Standard_User
Fields:
field: Hobby, readable: true, editable: true
field: AnnualIncome, readable: true, editable: false
field: PreferredContactMethod, readable: true, editable: true
```

### 2. With Permission Sets

**Template:**
```
Add custom fields to the [ObjectName] object with the following specifications:

Object Name: [ObjectName]
Fields:
Name: [FieldName], Label: [FieldLabel], Type: [FieldType], [Additional Properties]

Field Level Security (Profile Access):
Profile: [ProfileName]
Fields:
field: [FieldName], readable: [true/false], editable: [true/false]

Permission Set:
Name: [PermissionSetName]
Label: [PermissionSetLabel]
Object Permissions:
object: [ObjectName]
allowCreate: [true/false]
allowRead: [true/false]
allowEdit: [true/false]
allowDelete: [true/false]
viewAllRecords: [true/false]
modifyAllRecords: [true/false]
Field Permissions:
field: [ObjectName].[FieldName], readable: [true/false], editable: [true/false]
```

**Example:**
```
Add custom fields to the Account object with the following specifications:

Object Name: Account
Fields:
Name: IndustryType, Label: Industry Type, Type: Picklist, Picklist Values: ["Technology", "Healthcare", "Finance", "Manufacturing", "Retail"]
Name: AnnualRevenue, Label: Annual Revenue, Type: Currency, Precision: 18, Scale: 2
Name: CustomerTier, Label: Customer Tier, Type: Picklist, Picklist Values: ["Bronze", "Silver", "Gold", "Platinum"]

Field Level Security (Profile Access):
Profile: Standard_User
Fields:
field: IndustryType, readable: true, editable: true
field: AnnualRevenue, readable: true, editable: false
field: CustomerTier, readable: true, editable: true

Permission Set:
Name: Account_Manager
Label: Account Manager
Object Permissions:
object: Account
allowCreate: true
allowRead: true
allowEdit: true
allowDelete: false
viewAllRecords: false
modifyAllRecords: false
Field Permissions:
field: Account.IndustryType, readable: true, editable: true
field: Account.AnnualRevenue, readable: true, editable: true
field: Account.CustomerTier, readable: true, editable: true
```

### 3. With Validation Rules

**Template:**
```
Add custom fields to the [ObjectName] object with the following specifications:

Object Name: [ObjectName]
Fields:
Name: [FieldName], Label: [FieldLabel], Type: [FieldType], [Additional Properties]

Validation Rule:
Name: [ValidationRuleName]
Error Condition Formula: [Formula]
Error Message: [ErrorMessage]

Field Level Security (Profile Access):
Profile: [ProfileName]
Fields:
field: [FieldName], readable: [true/false], editable: [true/false]
```

**Example:**
```
Add custom fields to the Opportunity object with the following specifications:

Object Name: Opportunity
Fields:
Name: ExpectedCloseDate, Label: Expected Close Date, Type: Date
Name: Probability, Label: Probability, Type: Number, Precision: 3, Scale: 0
Name: DealSize, Label: Deal Size, Type: Picklist, Picklist Values: ["Small", "Medium", "Large", "Enterprise"]

Validation Rule:
Name: Probability_Must_Be_Valid
Error Condition Formula: Probability < 0 OR Probability > 100
Error Message: Probability must be between 0 and 100.

Field Level Security (Profile Access):
Profile: Standard_User
Fields:
field: ExpectedCloseDate, readable: true, editable: true
field: Probability, readable: true, editable: true
field: DealSize, readable: true, editable: true
```

## Field Types and Properties

### Text Fields
```
Name: FieldName, Label: Field Label, Type: Text, Length: 255
```

### Number Fields
```
Name: FieldName, Label: Field Label, Type: Number, Precision: 18, Scale: 2
```

### Currency Fields
```
Name: FieldName, Label: Field Label, Type: Currency, Precision: 18, Scale: 2
```

### Picklist Fields
```
Name: FieldName, Label: Field Label, Type: Picklist, Picklist Values: ["Option1", "Option2", "Option3"]
```

### Checkbox Fields
```
Name: FieldName, Label: Field Label, Type: Checkbox, DefaultValue: false
```

### Date Fields
```
Name: FieldName, Label: Field Label, Type: Date
```

### TextArea Fields
```
Name: FieldName, Label: Field Label, Type: TextArea
```

## Best Practices

1. **Field Naming**: Use descriptive names without spaces (e.g., "AnnualRevenue" not "Annual Revenue")
2. **Labels**: Use user-friendly labels with spaces (e.g., "Annual Revenue")
3. **Field Level Security**: Always specify FLS for sensitive fields
4. **Permission Sets**: Create specific permission sets for different user roles
5. **Validation Rules**: Add validation rules for data integrity
6. **Picklist Values**: Keep picklist values concise and meaningful

## Common Use Cases

### 1. Contact Management
- Hobbies, interests, preferences
- Communication preferences
- Personal information fields

### 2. Account Management
- Industry classifications
- Revenue information
- Customer tiers and segments

### 3. Opportunity Management
- Deal characteristics
- Probability and timing
- Custom qualification fields

### 4. Case Management
- Priority classifications
- Custom status fields
- Resolution tracking

## Deployment Process

1. **Parse Prompt**: The AI parses your prompt and generates JSON structure
2. **Generate Metadata**: Creates field XML files for standard objects
3. **Apply FLS**: Generates profile metadata for field-level security
4. **Create Permission Sets**: Generates permission set metadata (if specified)
5. **Deploy**: Uses SFDX to deploy metadata to your org

## Troubleshooting

- **Field Already Exists**: The system will overwrite existing field definitions
- **Permission Issues**: Ensure your org has the necessary permissions
- **Validation Errors**: Check field formulas and picklist values
- **Deployment Failures**: Review the deployment logs for specific errors

## Example Complete Prompts

### Contact Enhancement
```
Add custom fields to the Contact object with the following specifications:

Object Name: Contact
Fields:
Name: Hobby, Label: Hobby, Type: Picklist, Picklist Values: ["Reading", "Gaming", "Sports", "Music", "Travel"]
Name: AnnualIncome, Label: Annual Income, Type: Currency, Precision: 18, Scale: 2
Name: PreferredContactMethod, Label: Preferred Contact Method, Type: Picklist, Picklist Values: ["Email", "Phone", "SMS", "Mail"]
Name: NewsletterSubscription, Label: Newsletter Subscription, Type: Checkbox, DefaultValue: true

Validation Rule:
Name: AnnualIncome_Must_Be_Positive
Error Condition Formula: AnnualIncome < 0
Error Message: Annual income must be a positive value.

Field Level Security (Profile Access):
Profile: Standard_User
Fields:
field: Hobby, readable: true, editable: true
field: AnnualIncome, readable: true, editable: false
field: PreferredContactMethod, readable: true, editable: true
field: NewsletterSubscription, readable: true, editable: true

Permission Set:
Name: Contact_Manager
Label: Contact Manager
Object Permissions:
object: Contact
allowCreate: true
allowRead: true
allowEdit: true
allowDelete: false
viewAllRecords: false
modifyAllRecords: false
Field Permissions:
field: Contact.Hobby, readable: true, editable: true
field: Contact.AnnualIncome, readable: true, editable: true
field: Contact.PreferredContactMethod, readable: true, editable: true
field: Contact.NewsletterSubscription, readable: true, editable: true
```

### Account Enhancement
```
Add custom fields to the Account object with the following specifications:

Object Name: Account
Fields:
Name: IndustryType, Label: Industry Type, Type: Picklist, Picklist Values: ["Technology", "Healthcare", "Finance", "Manufacturing", "Retail", "Education", "Government"]
Name: AnnualRevenue, Label: Annual Revenue, Type: Currency, Precision: 18, Scale: 2
Name: CustomerTier, Label: Customer Tier, Type: Picklist, Picklist Values: ["Bronze", "Silver", "Gold", "Platinum"]
Name: AccountNotes, Label: Account Notes, Type: TextArea

Validation Rule:
Name: Revenue_Must_Be_Positive
Error Condition Formula: AnnualRevenue < 0
Error Message: Annual revenue must be a positive value.

Field Level Security (Profile Access):
Profile: Standard_User
Fields:
field: IndustryType, readable: true, editable: true
field: AnnualRevenue, readable: true, editable: false
field: CustomerTier, readable: true, editable: true
field: AccountNotes, readable: true, editable: true

Permission Set:
Name: Account_Manager
Label: Account Manager
Object Permissions:
object: Account
allowCreate: true
allowRead: true
allowEdit: true
allowDelete: false
viewAllRecords: false
modifyAllRecords: false
Field Permissions:
field: Account.IndustryType, readable: true, editable: true
field: Account.AnnualRevenue, readable: true, editable: true
field: Account.CustomerTier, readable: true, editable: true
field: Account.AccountNotes, readable: true, editable: true
``` 