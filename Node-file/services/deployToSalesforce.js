const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function cleanOldMetadata() {
    const objectDir = path.join(__dirname, '../../force-app/main/default/objects');
    const profileDir = path.join(__dirname, '../../force-app/main/default/profiles');
    const permSetDir = path.join(__dirname, '../../force-app/main/default/permissionsets');
    if (fs.existsSync(objectDir)) {
        fs.readdirSync(objectDir).forEach(file => {
            const filePath = path.join(objectDir, file);
            try {
                fs.rmSync(filePath, { recursive: true, force: true });
            } catch (err) {
                console.warn(`:warning: Failed to delete object metadata: ${filePath}`, err.message);
            }
        });
    }
    if (fs.existsSync(profileDir)) {
        fs.readdirSync(profileDir).forEach(file => {
            const filePath = path.join(profileDir, file);
            if (file.endsWith('.profile-meta.xml')) {
                try {
                    fs.rmSync(filePath, { force: true });
                    console.log(`:broom: Deleted profile: ${file}`);
                } catch (err) {
                    console.warn(`:warning: Failed to delete profile metadata: ${filePath}`, err.message);
                }
            }
        });
    }
    if (fs.existsSync(permSetDir)) {
        fs.readdirSync(permSetDir).forEach(file => {
            const filePath = path.join(permSetDir, file);
            if (file.endsWith('.permissionset-meta.xml')) {
                try {
                    fs.rmSync(filePath, { force: true });
                    console.log(`:broom: Deleted permission set: ${file}`);
                } catch (err) {
                    console.warn(`:warning: Failed to delete permission set metadata: ${filePath}`, err.message);
                }
            }
        });
    }
    console.log(':soap: Cleaned old object, profile, and permission set metadata');
}


async function deploy(objectDef) {
    cleanOldMetadata();

    // Check if this is a standard object or custom object
    // Standard objects are predefined by Salesforce (Contact, Account, Opportunity, etc.)
    const standardObjects = ['Contact', 'Account', 'Opportunity', 'Lead', 'Case', 'User', 'Profile', 'Role', 'Campaign', 'Asset', 'Contract', 'Order', 'Product2', 'Pricebook2'];
    const isStandardObject = standardObjects.includes(objectDef.object);
    
    let objectApiName = objectDef.object.replace(/\s+/g, '_');
    if (!isStandardObject && !objectApiName.endsWith('__c')) {
        objectApiName += '__c';
    }
    
    const workingDir = path.resolve(__dirname, '../../');
    const objectDir = path.join(workingDir, 'force-app/main/default/objects', objectApiName);
    const fieldsDir = path.join(objectDir, 'fields');

    console.log(`📁 Creating object directory: ${objectDir}`);
    fs.mkdirSync(fieldsDir, { recursive: true });
    console.log(`✅ Object directory created successfully`);

    // Define objectFilePath for both custom and standard objects
    const objectFilePath = path.join(objectDir, `${objectApiName}.object-meta.xml`);
    
    // Only create object XML for custom objects, not standard objects
    if (!isStandardObject) {
        // Clean object name for label (remove __c and convert to proper case)
        const objectLabel = objectDef.object.replace(/__c$/, '').replace(/_/g, ' ');
        const objectXml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${objectApiName}</fullName>
    <label>${objectLabel}</label>
    <pluralLabel>${objectLabel}s</pluralLabel>
    <nameField>
        <type>Text</type>
        <label>${objectLabel} Name</label>
    </nameField>
    <deploymentStatus>Deployed</deploymentStatus>
    <sharingModel>ReadWrite</sharingModel>
</CustomObject>`;

        fs.writeFileSync(objectFilePath, objectXml);
        console.log(`✅ Created Object XML: ${objectFilePath}`);
        console.log(`📄 Object XML content:`, objectXml);
    } else {
        console.log(`📝 Adding custom fields to existing standard object: ${objectApiName}`);
    }

    for (const field of objectDef.fields) {
        let extraAttributes = '';
        switch (field.type) {
            case 'Text':
                extraAttributes = `<length>${field.length || 100}</length>`;
                break;
            case 'Currency':
                extraAttributes = `<precision>${field.precision || 18}</precision><scale>${field.scale || 2}</scale>`;
                break;
            case 'Number':
                extraAttributes = `<precision>${field.precision || 18}</precision><scale>${field.scale || 0}</scale>`;
                break;
            case 'Checkbox':
                extraAttributes = `<defaultValue>${field.defaultValue || false}</defaultValue>`;
                break;
            case 'Picklist':
                if (field.picklistValues && Array.isArray(field.picklistValues)) {
                    const picklistValues = field.picklistValues.map(val => `
            <value>
                <fullName>${val}</fullName>
                <default>false</default>
                <label>${val}</label>
            </value>`).join('');
                    extraAttributes = `
        <valueSet>
            <restricted>true</restricted>
            <valueSetDefinition>
                <sorted>false</sorted>
                ${picklistValues}
            </valueSetDefinition>
        </valueSet>`;
                }
                break;
            case 'TextArea':
                extraAttributes = '';
                break;
            case 'Date':
                extraAttributes = '';
                break;
        }

        let fieldApiName = field.name.replace(/\s+/g, '_');
        if (!fieldApiName.endsWith('__c')) {
            fieldApiName += '__c';
        }

        const fieldXml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    <label>${field.label}</label>
    <type>${field.type}</type>
    ${extraAttributes}
    <externalId>false</externalId>
    <trackFeedHistory>false</trackFeedHistory>
    <trackHistory>false</trackHistory>
    <trackTrending>false</trackTrending>
</CustomField>`;

        const fieldPath = path.join(fieldsDir, `${fieldApiName}.field-meta.xml`);
        fs.writeFileSync(fieldPath, fieldXml);
        console.log(`✅ Created Field XML: ${fieldPath}`);
        console.log(`📄 Field XML content:`, fieldXml);
    }

    console.log(`🔍 Verifying created files...`);
    if (!isStandardObject && fs.existsSync(objectFilePath)) {
        console.log(`✅ Object file exists: ${objectFilePath}`);
    } else if (isStandardObject) {
        console.log(`📝 Standard object - no object file needed`);
    } else {
        console.log(`❌ Object file missing: ${objectFilePath}`);
    }
    const createdFields = fs.readdirSync(fieldsDir);
    console.log(`✅ Created ${createdFields.length} field files:`, createdFields);

    if (objectDef.profileAccess && Array.isArray(objectDef.profileAccess) && objectDef.profileAccess.length > 0) {
        const profilesDir = path.join(workingDir, 'force-app/main/default/profiles');
        fs.mkdirSync(profilesDir, { recursive: true });

        // Define the existing profiles that should have FLS applied
        const targetProfiles = ['Standard Platform User', 'Standard User', 'System Administrator'];
        console.log(`🎯 Applying FLS to existing profiles: ${targetProfiles.join(', ')}`);
        
        for (const profileName of targetProfiles) {
            // Create file name without spaces for the file system
            const profileFileName = profileName.replace(/\s+/g, '_');
            let fieldPermissions = '';
            
            // Get field permissions from the first profile access definition
            const access = objectDef.profileAccess[0];
            if (access && Array.isArray(access.fields)) {
                fieldPermissions = access.fields.map(fls => {
                    const fieldObj = objectDef.fields.find(f =>
                        (f.label && f.label.toLowerCase() === fls.field.toLowerCase()) ||
                        (f.name && f.name.toLowerCase() === fls.field.toLowerCase()) ||
                        (f.name && f.name.toLowerCase() === `${fls.field.toLowerCase()}__c`)
                    );
                    let apiFieldName;
                    if (fieldObj?.name) {
                        apiFieldName = fieldObj.name.replace(/\s+/g, '_');
                        if (!apiFieldName.endsWith('__c')) {
                            apiFieldName += '__c';
                        }
                    } else {
                        apiFieldName = fls.field.endsWith('__c') ? fls.field : `${fls.field}__c`;
                    }
                    console.log(`Mapping FLS for ${profileName}: '${fls.field}' → '${apiFieldName}'`);
                    
                    // Set permissions based on profile
                    let readable = true;
                    let editable = false;
                    
                    if (profileName === 'System Administrator') {
                        editable = true; // Full access for System Administrator
                    } else if (profileName === 'Standard User') {
                        // Use the permissions from the prompt
                        editable = fls.editable === true;
                    } else {
                        // Standard Platform User gets read-only access
                        editable = false;
                    }
                    
                    return `    <fieldPermissions>\n        <editable>${editable}</editable>\n        <field>${objectApiName}.${apiFieldName}</field>\n        <readable>${readable}</readable>\n    </fieldPermissions>`;
                }).join('\n');
            }

            const profileXml = `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${profileFileName}</fullName>
${fieldPermissions}
</Profile>`;

            const profilePath = path.join(profilesDir, `${profileFileName}.profile-meta.xml`);
            fs.writeFileSync(profilePath, profileXml);
            console.log(`🧾 Generated Profile XML for: ${profileName}`);
            console.log(`📄 Profile XML content:`, profileXml);
        }
    }

    // Permission Set Generation
    if (objectDef.permissionSets && Array.isArray(objectDef.permissionSets)) {
        const permSetsDir = path.join(workingDir, 'force-app/main/default/permissionsets');
        fs.mkdirSync(permSetsDir, { recursive: true });
        
        // Create the main permission set from the prompt
        for (const permSet of objectDef.permissionSets) {
            const permSetFileName = permSet.name.replace(/\s+/g, '_');
            let objectPermissions = '';
            if (permSet.objectPermissions) {
                let objName = permSet.objectPermissions.object;
                // For standard objects, don't add __c suffix
                if (!isStandardObject && objName && !objName.endsWith('__c')) {
                    objName = objName.replace(/\s+/g, '_') + '__c';
                }
                objectPermissions = `<objectPermissions>\n` +
                    `    <object>${objName}</object>\n` +
                    Object.entries(permSet.objectPermissions)
                        .filter(([key]) => key !== 'object')
                        .map(([key, value]) => `    <${key}>${value}</${key}>`)
                        .join('\n') +
                    `\n</objectPermissions>`;
            }
            let fieldPermissions = '';
            if (Array.isArray(permSet.fieldPermissions)) {
                fieldPermissions = permSet.fieldPermissions.map(fps => {
                    let fieldName = fps.field;
                    // Handle field names correctly for both custom and standard objects
                    if (fieldName && !fieldName.includes('__c')) {
                        const [obj, fld] = fieldName.split('.');
                        if (isStandardObject) {
                            // For standard objects: Account.FieldName -> Account.FieldName__c
                            fieldName = obj + '.' + fld.replace(/\s+/g, '_') + '__c';
                        } else {
                            // For custom objects: Car.FieldName -> Car__c.FieldName__c
                            fieldName = obj.replace(/\s+/g, '_') + '__c.' + fld.replace(/\s+/g, '_') + '__c';
                        }
                    }
                    return `    <fieldPermissions>\n        <field>${fieldName}</field>\n        <readable>${fps.readable === true}</readable>\n        <editable>${fps.editable === true}</editable>\n    </fieldPermissions>`;
                }).join('\n');
            }
            const permSetXml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<PermissionSet xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <fullName>${permSet.name}</fullName>\n    <label>${permSet.label || permSet.name}</label>\n${objectPermissions}\n${fieldPermissions}\n</PermissionSet>`;
            const permSetPath = path.join(permSetsDir, `${permSetFileName}.permissionset-meta.xml`);
            fs.writeFileSync(permSetPath, permSetXml);
            console.log(`🛡️ Generated Permission Set XML for: ${permSet.name}`);
            console.log(`📄 Permission Set XML content:`, permSetXml);
        }
        
        // Note: Only creating permission sets explicitly specified in the prompt
        // No automatic creation of additional permission sets
    }

    // Validation Rule Generation
    function escapeXml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    // Map field labels/names to API names
    const fieldNameMap = {};
    if (objectDef.fields) {
        for (const field of objectDef.fields) {
            let apiFieldName = field.name.replace(/\s+/g, '_');
            if (!apiFieldName.endsWith('__c')) {
                apiFieldName += '__c';
            }
            fieldNameMap[field.name] = apiFieldName;
            fieldNameMap[field.label] = apiFieldName;
        }
    }
    // Helper to replace field references in formula with API names
    function replaceFieldRefs(formula) {
        if (!formula) return '';
        Object.keys(fieldNameMap).forEach(key => {
            const regex = new RegExp(`\\b${key}\\b`, 'g');
            formula = formula.replace(regex, fieldNameMap[key]);
        });
        return formula;
    }
    
    // Helper to format validation rule formulas for Salesforce
    function formatValidationFormula(formula) {
        if (!formula) return '';
        
        // Replace common operators with Salesforce-compatible ones
        let formattedFormula = formula
            .replace(/\bOR\b/gi, '||')
            .replace(/\bAND\b/gi, '&&')
            .replace(/\bNOT\b/gi, '!')
            .replace(/\bTRUE\b/gi, 'true')
            .replace(/\bFALSE\b/gi, 'false');
        
        // Ensure proper spacing around operators
        formattedFormula = formattedFormula
            .replace(/([^=!<>])([=!<>]+)/g, '$1 $2')
            .replace(/([=!<>]+)([^=])/g, '$1 $2');
        
        return formattedFormula;
    }
    if (objectDef.validationRules && Array.isArray(objectDef.validationRules) && objectDef.validationRules.length > 0) {
        const validationRulesDir = path.join(objectDir, 'validationRules');
        fs.mkdirSync(validationRulesDir, { recursive: true });
        for (const rule of objectDef.validationRules) {
            const ruleFileName = rule.name.replace(/\s+/g, '_');
            const formulaWithApiNames = replaceFieldRefs(rule.errorConditionFormula);
            const formattedFormula = formatValidationFormula(formulaWithApiNames);
            const ruleXml = `<?xml version="1.0" encoding="UTF-8"?>\n<ValidationRule xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <fullName>${escapeXml(rule.name)}</fullName>\n    <active>true</active>\n    <description>${escapeXml(rule.description || rule.name)}</description>\n    <errorConditionFormula>${escapeXml(formattedFormula)}</errorConditionFormula>\n    <errorMessage>${escapeXml(rule.errorMessage)}</errorMessage>\n</ValidationRule>`;
            const rulePath = path.join(validationRulesDir, `${ruleFileName}.validationRule-meta.xml`);
            fs.writeFileSync(rulePath, ruleXml);
            console.log(`🧩 Generated Validation Rule XML for: ${rule.name}`);
            console.log(`📄 Validation Rule XML content:`, ruleXml);
        }
    }

    return new Promise((resolve, reject) => {
        console.log('🚀 Deploying objects...');
        const workingDir = path.resolve(__dirname, '../../');
        console.log(`📁 Working directory: ${workingDir}`);
        const sfdxProjectPath = path.join(workingDir, 'sfdx-project.json');
        console.log(`🔍 Checking if sfdx-project.json exists at: ${sfdxProjectPath}`);
        if (!fs.existsSync(sfdxProjectPath)) {
            return reject(new Error(`sfdx-project.json not found at: ${sfdxProjectPath}. This is not a valid Salesforce DX project.`));
        }
        console.log(`✅ sfdx-project.json found!`);
        const forceAppPath = path.join(workingDir, 'force-app');
        console.log(`🔍 Checking if force-app exists at: ${forceAppPath}`);
        if (!fs.existsSync(forceAppPath)) {
            return reject(new Error(`force-app directory not found at: ${forceAppPath}`));
        }
        console.log(`✅ force-app directory found!`);
        const objectsDir = path.join(forceAppPath, 'main/default/objects');
        console.log(`🔍 Checking if objects directory exists at: ${objectsDir}`);
        if (!fs.existsSync(objectsDir)) {
            console.log(`📁 Creating objects directory: ${objectsDir}`);
            fs.mkdirSync(objectsDir, { recursive: true });
        }
        console.log(`✅ objects directory ready!`);
        const manifestPath = path.join(workingDir, 'manifest', 'package.xml');
        const manifestDir = path.dirname(manifestPath);
        if (!fs.existsSync(manifestDir)) {
            fs.mkdirSync(manifestDir, { recursive: true });
        }
        // For standard objects, we need to specify the full field paths
        let manifestMembers = '';
        if (isStandardObject && objectDef.fields) {
            manifestMembers = objectDef.fields.map(field => {
                let apiFieldName = field.name.replace(/\s+/g, '_');
                if (!apiFieldName.endsWith('__c')) {
                    apiFieldName += '__c';
                }
                return `        <members>${objectApiName}.${apiFieldName}</members>`;
            }).join('\n');
        } else {
            manifestMembers = `        <members>${objectApiName}</members>`;
        }
        
        // Add validation rules to manifest if they exist
        let validationRuleMembers = '';
        if (objectDef.validationRules && Array.isArray(objectDef.validationRules) && objectDef.validationRules.length > 0) {
            validationRuleMembers = objectDef.validationRules.map(rule => {
                const ruleName = rule.name.replace(/\s+/g, '_');
                return `        <members>${objectApiName}.${ruleName}</members>`;
            }).join('\n');
        }
        
        const manifestContent = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        ${manifestMembers}
        <name>${isStandardObject ? 'CustomField' : 'CustomObject'}</name>
    </types>${validationRuleMembers ? `
    <types>
        ${validationRuleMembers}
        <name>ValidationRule</name>
    </types>` : ''}
    <version>64.0</version>
</Package>`;
        console.log(`📄 Manifest content:`, manifestContent);
        fs.writeFileSync(manifestPath, manifestContent);
        console.log(`📄 Created manifest file: ${manifestPath}`);

        const deployCommand = `sf deploy metadata --manifest manifest/package.xml --target-org "Anirban Pramanik" --test-level NoTestRun --verbose`;
        console.log(`🔧 Command: ${deployCommand}`);
        console.log(`🎯 Deploying to org: "Anirban Pramanik"`);
        console.log(`📦 Object API Name: ${objectApiName}`);
        console.log(`🏷️ Object Label: ${isStandardObject ? 'Standard Object' : (objectDef.object.replace(/__c$/, '').replace(/_/g, ' '))}`);
        console.log(`📝 Type: ${isStandardObject ? 'Adding custom fields to standard object' : 'Custom object'}`);

        setTimeout(() => {
            exec(deployCommand, { cwd: workingDir }, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Objects Deployment Error:', error);
                    console.error('❌ stderr:', stderr);
                    console.error('❌ stdout:', stdout);
                    return reject(new Error(`Deployment failed: ${error.message}`));
                }
                console.log('📦 Objects Deployment Output:\n', stdout);
                if (stderr) {
                    console.log('⚠️ stderr:', stderr);
                }
                
                // Check if deployment was successful
                if (stdout.includes('Deployed successfully') || stdout.includes('Success')) {
                    console.log('✅ Deployment completed successfully!');
                    if (isStandardObject) {
                        console.log('🔍 Check your org for the new custom fields:');
                        console.log(`   - Setup > Object Manager > ${objectApiName} > Fields & Relationships`);
                        console.log(`   - Or go to Setup > Object Manager and look for "${objectApiName}"`);
                    } else {
                        console.log('🔍 Check your org for the new custom object:');
                        console.log('   - Setup > Object Manager > Car__c');
                        console.log('   - Or search for "Car" in the app launcher');
                        console.log('   - Or go to Setup > Object Manager and look for "Car"');
                    }
                } else {
                    console.log('⚠️ Deployment may have issues. Check the output above.');
                    console.log('🔍 Full deployment output for debugging:');
                    console.log(stdout);
                }

                if (objectDef.profileAccess?.length > 0) {
                    const profilesDir = path.join(__dirname, '../../force-app/main/default/profiles');
                    if (fs.existsSync(profilesDir)) {
                        console.log('🚀 Deploying profiles...');
                        const profileCommand = 'sf deploy metadata --source-dir force-app/main/default/profiles --test-level NoTestRun --target-org "Anirban Pramanik"';
                        exec(profileCommand, { cwd: workingDir }, (profileError, profileStdout, profileStderr) => {
                            if (profileError) {
                                console.error('⚠️ Profiles Deployment Error:', profileError);
                                console.error('⚠️ profile stderr:', profileStderr);
                                console.error('⚠️ profile stdout:', profileStdout);
                                return reject(new Error(`Profile deployment failed: ${profileError.message}`));
                            }
                            console.log('📦 Profiles Deployment Output:\n', profileStdout);
                            if (profileStderr) {
                                console.log('⚠️ profile stderr:', profileStderr);
                            }
                            // Deploy permission sets if present
                            if (objectDef.permissionSets?.length > 0) {
                                const permSetsDir = path.join(__dirname, '../../force-app/main/default/permissionsets');
                                if (fs.existsSync(permSetsDir)) {
                                    console.log('🛡️ Deploying permission sets...');
                                    const permSetCommand = 'sf deploy metadata --source-dir force-app/main/default/permissionsets --test-level NoTestRun --target-org "Anirban Pramanik"';
                                    exec(permSetCommand, { cwd: workingDir }, (permSetError, permSetStdout, permSetStderr) => {
                                        if (permSetError) {
                                            console.error('⚠️ Permission Set Deployment Error:', permSetError);
                                            console.error('⚠️ perm set stderr:', permSetStderr);
                                            console.error('⚠️ perm set stdout:', permSetStdout);
                                            return reject(new Error(`Permission Set deployment failed: ${permSetError.message}`));
                                        }
                                        console.log('📦 Permission Set Deployment Output:\n', permSetStdout);
                                        if (permSetStderr) {
                                            console.log('⚠️ perm set stderr:', permSetStderr);
                                        }
                                        resolve(stdout + profileStdout + permSetStdout);
                                    });
                                } else {
                                    console.warn('⚠️ Permission sets directory not found, skipping deployment');
                                    resolve(stdout + profileStdout);
                                }
                            } else {
                                resolve(stdout + profileStdout);
                            }
                        });
                    } else {
                        console.warn('⚠️ Profiles directory not found, skipping deployment');
                        resolve(stdout);
                    }
                } else if (objectDef.permissionSets?.length > 0) {
                    // Deploy permission sets if no profiles
                    const permSetsDir = path.join(__dirname, '../../force-app/main/default/permissionsets');
                    if (fs.existsSync(permSetsDir)) {
                        console.log('🛡️ Deploying permission sets...');
                        const permSetCommand = 'sf deploy metadata --source-dir force-app/main/default/permissionsets --test-level NoTestRun --target-org "Anirban Pramanik"';
                        exec(permSetCommand, { cwd: workingDir }, (permSetError, permSetStdout, permSetStderr) => {
                            if (permSetError) {
                                console.error('⚠️ Permission Set Deployment Error:', permSetError);
                                console.error('⚠️ perm set stderr:', permSetStderr);
                                console.error('⚠️ perm set stdout:', permSetStdout);
                                return reject(new Error(`Permission Set deployment failed: ${permSetError.message}`));
                            }
                            console.log('📦 Permission Set Deployment Output:\n', permSetStdout);
                            if (permSetStderr) {
                                console.log('⚠️ perm set stderr:', permSetStderr);
                            }
                            resolve(stdout + permSetStdout);
                        });
                    } else {
                        console.warn('⚠️ Permission sets directory not found, skipping deployment');
                        resolve(stdout);
                    }
                } else {
                    resolve(stdout);
                }
            });
        }, 1000);
    });
}

module.exports = {
    deploy,
    generateObjectXML: (objectName, fields) => {
        const objectDef = {
            object: objectName,
            fields: fields.map(field => ({
                name: field.name,
                label: field.label,
                type: field.type,
                ...field
            }))
        };
        return deploy(objectDef);
    },
    deployMetadata: () => Promise.resolve('Deployment handled by deploy()')
};
