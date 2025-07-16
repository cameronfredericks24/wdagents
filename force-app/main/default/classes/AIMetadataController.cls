public with sharing class AIMetadataController {

    @AuraEnabled
    public static String processInstruction(String instruction) {
        MetadataAPI__c settings = MetadataAPI__c.getInstance(UserInfo.getUserId());
        if (settings == null || String.isBlank(settings.Username__c) || String.isBlank(settings.Password__c)) {
            throw new AuraHandledException('API credentials not configured.');
        }
        String sessionId = getSessionId(settings.Username__c, settings.Password__c);
        if (String.isBlank(sessionId)) {
            throw new AuraHandledException('Failed to get a session ID.');
        }
        MetadataService.MetadataPort service = createService(sessionId);
        
        // Robust instruction splitting: split by newline, semicolon, or multiple spaces
        List<String> instructions = new List<String>();
        if (Pattern.compile('[\n;]+').matcher(instruction).find()) {
            for (String part : instruction.split('[\n;]+')) {
                if (!String.isBlank(part.trim())) instructions.add(part.trim());
            }
        } else {
            instructions.add(instruction.trim());
        }
        List<String> results = new List<String>();
        Map<String, String> roleLabelToApiName = new Map<String, String>();

        // Track created profile names to avoid duplicates in the same prompt
        Set<String> createdProfileNames = new Set<String>();

        // First pass: Create all non-role metadata
        for (String singleInstruction : instructions) {
            String cleanInstruction = singleInstruction.toLowerCase().trim();
            if (cleanInstruction == '') continue;
            try {
                if (cleanInstruction.startsWith('create a profile')) {
                    // Check for duplicate profile name in this prompt
                    Map<String, String> profileDetails = parseProfileDetails(singleInstruction);
                    String newProfileName = profileDetails.get('newProfileName');
                    if (createdProfileNames.contains(newProfileName)) {
                        results.add('Error: Duplicate profile name in prompt: ' + newProfileName);
                        continue;
                    }
                    createdProfileNames.add(newProfileName);
                    results.add(handleCreateProfile(service, singleInstruction));
                } else if (cleanInstruction.contains('clone') && cleanInstruction.contains('profile')) {
                    results.add(handleCloneProfiles(service, singleInstruction));
                } else if (cleanInstruction.startsWith('give profile') || cleanInstruction.startsWith('allow profile') || cleanInstruction.startsWith('make') || cleanInstruction.startsWith('enable') || cleanInstruction.startsWith('disable')) {
                    results.add(handleModifyProfile(service, singleInstruction));
                } else if (cleanInstruction.startsWith('add')) {
                    results.add(handleCreateField(service, singleInstruction));
                } else if (cleanInstruction.startsWith('create a record type')) {
                    results.add(handleCreateRecordType(service, singleInstruction));
                } else if (cleanInstruction.startsWith('create a user')) {
                    results.add(handleCreateUser(service, singleInstruction));
                } else if (cleanInstruction.startsWith('create') && !cleanInstruction.startsWith('create a role')) {
                    results.add(handleCreateObject(service, singleInstruction));
                }
            } catch (Exception e) {
                results.add('Error: ' + e.getMessage());
            }
        }

        // Second pass: Create roles in order (parents first, then children)
        List<String> roleInstructions = new List<String>();
        for (String singleInstruction : instructions) {
            String cleanInstruction = singleInstruction.toLowerCase().trim();
            if (cleanInstruction.startsWith('create a role')) {
                roleInstructions.add(singleInstruction);
            }
        }

        // Sort roles: parents first, then children
        List<String> sortedRoleInstructions = sortRoleInstructions(roleInstructions);
        
        for (String roleInstruction : sortedRoleInstructions) {
            try {
                String result = handleCreateRole(service, roleInstruction, roleLabelToApiName);
                results.add(result);
                
                // Update the role map after successful creation
                Map<String, String> roleDetails = parseRoleDetails(roleInstruction);
                String roleLabel = roleDetails.get('roleLabel');
                String roleApiName = roleDetails.get('roleName');
                if (roleLabel != null && roleApiName != null) {
                    roleLabelToApiName.put(roleLabel, roleApiName);
                }
            } catch (Exception e) {
                results.add('Error creating role: ' + e.getMessage());
            }
        }
        
        return String.join(results, '\n');
    }

    // Helper method to sort role instructions (parents first, then children)
    private static List<String> sortRoleInstructions(List<String> roleInstructions) {
        Map<String, String> roleToParent = new Map<String, String>();
        Set<String> allRoles = new Set<String>();
        
        // Parse all roles and their parents
        for (String instruction : roleInstructions) {
            Map<String, String> details = parseRoleDetails(instruction);
            String roleLabel = details.get('roleLabel');
            String parentLabel = details.get('parentRole');
            
            if (roleLabel != null) {
                allRoles.add(roleLabel);
                if (String.isNotBlank(parentLabel)) {
                    roleToParent.put(roleLabel, parentLabel);
                }
            }
        }
        
        // Sort: parents first, then children
        List<String> sortedInstructions = new List<String>();
        Set<String> processedRoles = new Set<String>();
        
        // First, add roles without parents
        for (String instruction : roleInstructions) {
            Map<String, String> details = parseRoleDetails(instruction);
            String roleLabel = details.get('roleLabel');
            String parentLabel = details.get('parentRole');
            
            if (roleLabel != null && String.isBlank(parentLabel)) {
                sortedInstructions.add(instruction);
                processedRoles.add(roleLabel);
            }
        }
        
        // Then, add roles with parents (assuming parents are already processed)
        for (String instruction : roleInstructions) {
            Map<String, String> details = parseRoleDetails(instruction);
            String roleLabel = details.get('roleLabel');
            String parentLabel = details.get('parentRole');
            
            if (roleLabel != null && String.isNotBlank(parentLabel) && !processedRoles.contains(roleLabel)) {
                sortedInstructions.add(instruction);
                processedRoles.add(roleLabel);
            }
        }
        
        return sortedInstructions;
    }

    // Updated handleCreateRole method
    private static String handleCreateRole(MetadataService.MetadataPort service, String instruction, Map<String, String> roleLabelToApiName) {
        Map<String, String> roleDetails = parseRoleDetails(instruction);
        String roleLabel = roleDetails.get('roleLabel');
        String roleApiName = roleDetails.get('roleName');
        String parentRoleLabel = roleDetails.get('parentRole');
        Id parentRoleId = null;

        if (String.isBlank(roleApiName)) {
            return 'I could not figure out the role details. Format: "Create a role called [New Role Label] that reports to [Parent Role Name]" or "Create a role called [New Role Label]" for the first role.';
        }

        // Resolve parent role Id if needed
        if (String.isNotBlank(parentRoleLabel)) {
            List<UserRole> parents = [SELECT Id FROM UserRole WHERE Name = :parentRoleLabel LIMIT 1];
            if (!parents.isEmpty()) {
                parentRoleId = parents[0].Id;
            }
        }

        UserRole newRole = new UserRole(
            Name = roleLabel,
            DeveloperName = roleApiName,
            ParentRoleId = parentRoleId
        );
        insert newRole;
        return 'Role created with name ' + newRole.Name;
    }

    private static String handleCreateProfile(MetadataService.MetadataPort service, String instruction) {
        Map<String, String> profileDetails = parseProfileDetails(instruction);
        String newProfileName = profileDetails.get('newProfileName');
        String sourceProfileName = profileDetails.get('sourceProfileName');

        if (String.isBlank(newProfileName) || String.isBlank(sourceProfileName)) {
            return 'I could not figure out the profile details. Format: "Create a profile called [New Profile Name] by cloning [Source Profile Name]"';
        }

        try {
            System.debug('Attempting to create profile: ' + newProfileName + ' by cloning: ' + sourceProfileName);
            
            // First, retrieve the source profile - FIXED: Properly handle ReadProfileResult
            String sourceProfileApiName = getProfileApiName(sourceProfileName);
            if (String.isBlank(sourceProfileApiName)) {
                return 'Source profile "' + sourceProfileName + '" not found. Please check the profile name or label. Available profiles can be found in Setup > Profiles.';
            }
            
            System.debug('Source profile API name resolved to: ' + sourceProfileApiName);
            
            // Check if the new profile name already exists
            String newProfileApiName = getProfileApiName(newProfileName);
            if (String.isNotBlank(newProfileApiName)) {
                return 'Profile "' + newProfileName + '" already exists. Please choose a different name.';
            }
            
            // Check profile cloneability before attempting to clone
            String cloneabilityCheck = checkProfileCloneability(sourceProfileApiName);
            if (cloneabilityCheck == 'Profile not found') {
                return 'Source profile "' + sourceProfileName + '" not found. Please check the profile name.';
            }
            
            // Special handling for problematic profiles - but allow cloning attempts
            String specialHandlingResult = handleSpecialProfileTypes(sourceProfileName, sourceProfileApiName);
            if (String.isNotBlank(specialHandlingResult) && specialHandlingResult.contains('⚠️')) {
                // Instead of blocking, provide a warning but continue with cloning attempt
                System.debug('Warning: ' + specialHandlingResult);
            }
            
            // Enhanced check for all custom profiles with better guidance
            List<Profile> sourceProfileDetails = [SELECT UserLicense.Name, Description, UserType FROM Profile WHERE Name = :sourceProfileApiName LIMIT 1];
            if (!sourceProfileDetails.isEmpty()) {
                Profile sourceProfileDetail = sourceProfileDetails[0];
                String licenseName = sourceProfileDetail.UserLicense.Name;
                String userType = sourceProfileDetail.UserType;
                String description = sourceProfileDetail.Description;
                
                // Check if this is a custom profile (not a standard Salesforce profile)
                Boolean isCustomProfile = !licenseName.equals('Salesforce') && 
                                        !licenseName.equals('Salesforce Platform') && 
                                        !licenseName.equals('Force.com - App Subscription');
                
                // Check for specific problematic profile types
                Boolean isProblematicProfile = licenseName.contains('High Volume Customer Portal') || 
                                             licenseName.contains('Customer Portal') ||
                                             licenseName.contains('Partner') ||
                                             licenseName.contains('Community') ||
                                             licenseName.contains('Identity') ||
                                             licenseName.contains('Force.com') ||
                                             licenseName.contains('Chatter') ||
                                             licenseName.contains('Analytics') ||
                                             licenseName.contains('API Only') ||
                                             licenseName.contains('Minimum Access') ||
                                             licenseName.contains('External') ||
                                             licenseName.contains('Einstein') ||
                                             licenseName.contains('B2B') ||
                                             licenseName.contains('Cross Org') ||
                                             (description != null && description.contains('High Volume Customer Portal'));
                
                if (isProblematicProfile) {
                    String profileType = 'custom profile';
                    if (licenseName.contains('High Volume Customer Portal')) profileType = 'High Volume Customer Portal profile';
                    else if (licenseName.contains('Partner')) profileType = 'Partner profile';
                    else if (licenseName.contains('Community')) profileType = 'Community profile';
                    else if (licenseName.contains('API Only')) profileType = 'API Only profile';
                    else if (licenseName.contains('Minimum Access')) profileType = 'Minimum Access profile';
                    
                    // Instead of blocking, provide a warning but allow the attempt
                    System.debug('Warning: Attempting to clone ' + profileType + ' with license: ' + licenseName + ', user type: ' + userType);
                    System.debug('This profile type may have restrictions, but attempting to clone anyway...');
                    
                    // Add a warning message to the result but don't block
                    System.debug('⚠️ WARNING: ' + profileType + 's may have special restrictions, but attempting to clone...');
                    
                } else if (isCustomProfile) {
                    // For other custom profiles, provide a warning but allow the attempt
                    System.debug('Warning: Attempting to clone custom profile with license: ' + licenseName + ', user type: ' + userType);
                }
            }
            
            // Allow cloning with restrictions but provide warnings
            if (cloneabilityCheck == 'CLONEABLE_WITH_RESTRICTIONS') {
                System.debug('Cloning profile with restrictions: ' + sourceProfileName);
            } else if (cloneabilityCheck != 'CLONEABLE') {
                // Instead of blocking, provide a warning but continue with cloning attempt
                System.debug('Warning: Profile may have restrictions: ' + cloneabilityCheck);
                System.debug('Attempting to clone anyway: ' + sourceProfileName);
            }
            
            MetadataService.ReadProfileResult readResult = (MetadataService.ReadProfileResult) service.readMetadata('Profile', new String[] { sourceProfileApiName });
            
            if (readResult == null || readResult.records == null || readResult.records.isEmpty()) {
                throw new AuraHandledException('Source profile "' + sourceProfileName + '" not found. Please check the profile name.');
            }

            MetadataService.Profile sourceProfile = readResult.records[0];
            System.debug('Successfully retrieved source profile: ' + sourceProfile.fullName);
            
            // Create new profile by cloning the source
            MetadataService.Profile newProfile = new MetadataService.Profile();
            newProfile.fullName = newProfileName;
            
            // Copy all the important settings from source profile
            newProfile.applicationVisibilities = sourceProfile.applicationVisibilities;
            newProfile.classAccesses = sourceProfile.classAccesses;
            newProfile.customPermissions = sourceProfile.customPermissions;
            newProfile.description = 'Cloned from ' + sourceProfileName;
            newProfile.externalDataSourceAccesses = sourceProfile.externalDataSourceAccesses;
            newProfile.fieldPermissions = sourceProfile.fieldPermissions;
            newProfile.loginHours = sourceProfile.loginHours;
            newProfile.loginIpRanges = sourceProfile.loginIpRanges;
            newProfile.objectPermissions = sourceProfile.objectPermissions;
            newProfile.pageAccesses = sourceProfile.pageAccesses;
            newProfile.recordTypeVisibilities = sourceProfile.recordTypeVisibilities;
            
            // Filter tab visibilities to only include valid tabs
            newProfile.tabVisibilities = filterValidTabVisibilities(sourceProfile.tabVisibilities);
            
            newProfile.userPermissions = sourceProfile.userPermissions;
            
            // Copy user license if available
            if (sourceProfile.userLicense != null) {
                newProfile.userLicense = sourceProfile.userLicense;
            }

            System.debug('Attempting to create new profile with name: ' + newProfileName);
            List<MetadataService.SaveResult> results = service.createMetadata(new MetadataService.Metadata[] { newProfile });
            
            // Enhanced error handling
            String result = processSaveResults(results, 'profile');
            if (result.contains('Error')) {
                System.debug('Profile creation failed: ' + result);
                
                // Provide specific guidance based on profile type
                if (cloneabilityCheck == 'CLONEABLE_WITH_RESTRICTIONS') {
                    return result + '\n\n⚠️ This profile type may have special restrictions.\n' +
                           'Troubleshooting tips:\n' +
                           '1. Ensure you have the "Manage Profiles and Permission Sets" permission\n' +
                           '2. Some profile types require specific user licenses\n' +
                           '3. Check if the profile name follows naming conventions\n' +
                           '4. Try using a standard profile like "Standard User" as source instead';
                } else {
                    return result + '\n\nTroubleshooting tips:\n' +
                           '1. Ensure you have the "Manage Profiles and Permission Sets" permission\n' +
                           '2. Check that the source profile is cloneable\n' +
                           '3. Verify the new profile name is unique and follows naming conventions\n' +
                           '4. Some profiles may have restrictions on cloning';
                }
            }
            
            System.debug('Profile created successfully: ' + newProfileName);
            
            // Add success message with additional info for restricted profiles
            if (cloneabilityCheck == 'CLONEABLE_WITH_RESTRICTIONS') {
                return result + '\n\n✅ Profile created successfully!\n' +
                       '⚠️ Note: This profile type may have special license requirements.\n' +
                       'Please review the profile settings in Setup > Profiles after creation.';
            }
            
            return result;
            
        } catch (Exception e) {
            System.debug('Exception in handleCreateProfile: ' + e.getMessage() + '\nStack: ' + e.getStackTraceString());
            throw new AuraHandledException('Error creating profile: ' + e.getMessage() + '\n\nCommon issues:\n' +
                '1. Insufficient permissions to create profiles\n' +
                '2. Source profile not found or not accessible\n' +
                '3. Profile name conflicts or invalid naming\n' +
                '4. Metadata API limitations for certain profile types\n' +
                '5. License restrictions for specialized profile types');
        }
    }

    // New method to handle special profile types that need specific logic
    private static String handleSpecialProfileTypes(String sourceProfileName, String sourceProfileApiName) {
        try {
            // Get profile details
            List<Profile> profiles = [SELECT Name, UserLicense.Name, UserType FROM Profile WHERE Name = :sourceProfileApiName LIMIT 1];
            if (profiles.isEmpty()) {
                return null; // Let normal flow handle it
            }
            
            Profile p = profiles[0];
            String licenseName = p.UserLicense.Name;
            String userType = p.UserType;
            
            // Provide warnings for problematic profiles but don't block cloning
            if (sourceProfileName.contains('Silver Partner User') || sourceProfileName.contains('Gold Partner User')) {
                return '⚠️ Partner profiles require special handling. These profiles are tied to Partner licenses and may not be cloneable through the Metadata API.\n\n' +
                       '💡 Recommendation: Use "Standard User" or "System Administrator" as the source profile instead.';
            }
            
            if (sourceProfileName.contains('Salesforce API Only System Integrations')) {
                return '⚠️ API Only profiles have severe restrictions and may not be cloneable through the Metadata API.\n\n' +
                       '💡 Recommendation: Use "Standard User" as the source profile instead.';
            }
            
            if (sourceProfileName.contains('Partner Community') || sourceProfileName.contains('Customer Community')) {
                return '⚠️ Community profiles require specific Community licenses and may not be cloneable.\n\n' +
                       '💡 Recommendation: Use "Standard User" as the source profile instead.';
            }
            
            if (sourceProfileName.contains('Minimum Access')) {
                return '⚠️ Minimum Access profiles have severe restrictions and may not be cloneable.\n\n' +
                       '💡 Recommendation: Use "Standard User" as the source profile instead.';
            }
            
            if (sourceProfileName.contains('Identity User') || sourceProfileName.contains('External Identity')) {
                return '⚠️ Identity profiles require specific Identity licenses and may not be cloneable.\n\n' +
                       '💡 Recommendation: Use "Standard User" as the source profile instead.';
            }
            
            if (sourceProfileName.contains('Force.com')) {
                return '⚠️ Force.com profiles require specific Force.com licenses and may not be cloneable.\n\n' +
                       '💡 Recommendation: Use "Standard User" as the source profile instead.';
            }
            
            if (sourceProfileName.contains('Chatter')) {
                return '⚠️ Chatter profiles require specific Chatter licenses and may not be cloneable.\n\n' +
                       '💡 Recommendation: Use "Standard User" as the source profile instead.';
            }
            
            if (sourceProfileName.contains('Analytics Cloud')) {
                return '⚠️ Analytics Cloud profiles require specific Analytics licenses and may not be cloneable.\n\n' +
                       '💡 Recommendation: Use "Standard User" as the source profile instead.';
            }
            
            if (sourceProfileName.contains('B2B') || sourceProfileName.contains('Authenticated Website')) {
                return '⚠️ B2B and Authenticated Website profiles require specific licenses and may not be cloneable.\n\n' +
                       '💡 Recommendation: Use "Standard User" as the source profile instead.';
            }
            
            if (sourceProfileName.contains('Cross Org') || sourceProfileName.contains('Einstein')) {
                return '⚠️ Cross Org and Einstein profiles require specific licenses and may not be cloneable.\n\n' +
                       '💡 Recommendation: Use "Standard User" as the source profile instead.';
            }
            
            // For custom profiles, try to clone but with warnings
            if (sourceProfileName.contains('Custom:')) {
                return null; // Let normal flow handle it with warnings
            }
            
            return null; // Let normal flow handle it
            
        } catch (Exception e) {
            System.debug('Error in handleSpecialProfileTypes: ' + e.getMessage());
            return null; // Let normal flow handle it
        }
    }

    // Enhanced method to check if a profile is cloneable
    private static String checkProfileCloneability(String profileApiName) {
        try {
            List<Profile> profiles = [SELECT Name, UserLicense.Name, UserType FROM Profile WHERE Name = :profileApiName LIMIT 1];
            if (profiles.isEmpty()) {
                return 'Profile not found';
            }
            
            Profile p = profiles[0];
            String licenseName = p.UserLicense.Name;
            String userType = p.UserType;
            
            // Profiles that are generally cloneable (confirmed working)
            Set<String> cloneableProfiles = new Set<String>{
                'System Administrator', 'Standard User', 'Standard Platform User',
                'Read Only', 'Marketing User', 'Contract Manager', 'Solution Manager',
                'High Volume Customer Portal'
            };
            
            // Profiles that are cloneable but with restrictions
            Set<String> restrictedProfiles = new Set<String>{
                'High Volume Customer Portal User', 'Customer Portal Manager Standard',
                'Customer Portal Manager Custom', 'Custom: Support Profile',
                'Custom: Sales Profile', 'Custom: Marketing Profile'
            };
            
            // Profiles that cannot be cloned due to license restrictions
            Set<String> nonCloneableProfiles = new Set<String>{
                'Silver Partner User', 'Gold Partner User', 'Salesforce API Only System Integrations',
                'Partner Community User', 'Partner Community Login User', 'Partner App Subscription User',
                'Minimum Access- Salesforce', 'Minimum Access-API Only Integrations', 'Identity User',
                'External Identity User', 'Force.com - Free User', 'Force.com - App Subscription User',
                'External Apps Login User', 'Einstein Agent User', 'Customer Community User',
                'Customer Community Plus User', 'Customer Community Plus Login User', 'Customer Community Login User',
                'Cross Org Data Proxy User', 'Chatter Moderator User', 'Chatter Free User', 'Chatter External User',
                'B2B Reordering Portal Buyer Profile', 'Authenticated Website', 'Analytics Cloud Security User',
                'Analytics Cloud Integration User'
            };
            
            // Check for specific profile names first
            if (cloneableProfiles.contains(p.Name)) {
                return 'CLONEABLE';
            } else if (restrictedProfiles.contains(p.Name)) {
                return 'CLONEABLE_WITH_RESTRICTIONS';
            } else if (nonCloneableProfiles.contains(p.Name)) {
                return 'NOT_CLONEABLE - Specialized profile with license restrictions';
            }
            
            // Custom profiles are cloneable
            if (p.Name.endsWith('__c')) {
                return 'CLONEABLE';
            }
            
            // For profiles not in our lists, check based on license type and user type
            if (licenseName != null) {
                if (licenseName.contains('Partner') || licenseName.contains('Community') || 
                    licenseName.contains('Identity') || licenseName.contains('Force.com') ||
                    licenseName.contains('Chatter') || licenseName.contains('Analytics') ||
                    licenseName.contains('API Only') || licenseName.contains('Minimum Access') ||
                    licenseName.contains('External') || licenseName.contains('Einstein') ||
                    licenseName.contains('B2B') || licenseName.contains('Cross Org')) {
                    return 'NOT_CLONEABLE - License restrictions';
                }
            }
            
            // Check user type for additional restrictions
            if (userType != null) {
                if (userType.contains('Partner') || userType.contains('Community') || 
                    userType.contains('External') || userType.contains('Identity') ||
                    userType.contains('Chatter') || userType.contains('Analytics')) {
                    return 'NOT_CLONEABLE - User type restrictions';
                }
            }
            
            // For custom profiles or unknown profiles, allow with restrictions
            if (p.Name.contains('Custom:')) {
                return 'CLONEABLE_WITH_RESTRICTIONS';
            }
            
            // Default to cloneable with restrictions for unknown profiles
            return 'CLONEABLE_WITH_RESTRICTIONS';
            
        } catch (Exception e) {
            System.debug('Error checking profile cloneability: ' + e.getMessage());
            return 'Error checking profile';
        }
    }

    private static String handleModifyProfile(MetadataService.MetadataPort service, String instruction) {
        Map<String, String> modificationDetails = parseModificationDetails(instruction);
        String profileName = modificationDetails.get('profileName');
        String modificationType = modificationDetails.get('modificationType');

        // ADDED: Debug logging
        System.debug('Profile Name: ' + profileName);
        System.debug('Modification Type: ' + modificationType);
        System.debug('All Details: ' + modificationDetails);

        if (String.isBlank(profileName)) {
            return 'I could not figure out the profile name. Please specify which profile to modify.';
        }

        if (String.isBlank(modificationType)) {
            return 'I could not understand the modification type. Supported types: object permissions, field permissions, class access, system permissions.';
        }

        try {
            // For now, let's return a message that profile modifications are complex
            // and suggest using the profile creation approach instead
            return 'Profile modification is complex through Metadata API. For now, I can help you create new profiles with specific permissions. Try: "Create a profile called [New Profile Name] by cloning [Source Profile Name]" and then manually adjust permissions in Setup.';
            
        } catch (Exception e) {
            throw new AuraHandledException('Error modifying profile: ' + e.getMessage() + ' Stack: ' + e.getStackTraceString());
        }
    }

    private static String handleCreateField(MetadataService.MetadataPort service, String instruction) {
        Map<String, String> fieldDetails = parseFieldDetails(instruction);
        String objectName = fieldDetails.get('objectName');
        String fieldName = fieldDetails.get('fieldName');
        String fieldType = fieldDetails.get('fieldType');

        // ADDED: Debug logging
        System.debug('Object Name: ' + objectName);
        System.debug('Field Name: ' + fieldName);
        System.debug('Field Type: ' + fieldType);
        System.debug('Is Standard Object: ' + isStandardObject(objectName));

        if(String.isBlank(objectName) || String.isBlank(fieldName)) {
            return 'I could not figure out the object and field name. Format: "Add a [Type] field called [FieldName] to [ObjectName]"';
        }

        if (fieldType == 'Picklist') {
            return createPicklistInTwoSteps(service, objectName, fieldName, fieldDetails.get('picklistValues'));
        }
        
        MetadataService.CustomField customField = new MetadataService.CustomField();
        
        // FIXED: Handle standard objects vs custom objects
        String fullFieldName;
        if (isStandardObject(objectName)) {
            // Standard objects don't need __c suffix
            fullFieldName = objectName + '.' + fieldName.trim().replaceAll(' ','_') + '__c';
        } else {
            // Custom objects need __c suffix
            fullFieldName = objectName.trim().replaceAll('__c$','') + '__c.' + fieldName.trim().replaceAll(' ','_') + '__c';
        }
        
        System.debug('Full Field Name: ' + fullFieldName);
        customField.fullName = fullFieldName;
        customField.label = fieldName.trim();
        
        switch on fieldType {
            when 'Currency' {
                customField.type_x = 'Currency'; customField.precision = 18; customField.scale = 2;
            }
            when 'Date' {
                customField.type_x = 'Date';
            }
            when 'Checkbox' {
                customField.type_x = 'Checkbox'; customField.defaultValue = 'false';
            }
            when 'DateTime' {
                customField.type_x = 'DateTime';
            }
            when 'Email' {
                customField.type_x = 'Email'; customField.unique = false;
            }
            when 'Phone' {
                customField.type_x = 'Phone';
            }
            when 'TextArea' {
                customField.type_x = 'TextArea';
            }
            when 'Time' {
                customField.type_x = 'Time';
            }
            when 'Url' {
                customField.type_x = 'Url';
            }
            when 'Number', 'Percent' {
                customField.type_x = fieldType;
                Integer precision = String.isNotBlank(fieldDetails.get('precision')) ? Integer.valueOf(fieldDetails.get('precision')) : 18;
                Integer scale = String.isNotBlank(fieldDetails.get('scale')) ? Integer.valueOf(fieldDetails.get('scale')) : 0;
                customField.precision = precision; customField.scale = scale;
            }
            when 'LongTextArea', 'Html' {
                customField.type_x = fieldType;
                Integer length = String.isNotBlank(fieldDetails.get('length')) ? Integer.valueOf(fieldDetails.get('length')) : 32768;
                Integer visibleLines = String.isNotBlank(fieldDetails.get('visibleLines')) ? Integer.valueOf(fieldDetails.get('visibleLines')) : 3;
                customField.length = length; customField.visibleLines = visibleLines;
            }
            when 'Lookup' {
                customField.type_x = 'Lookup';
                String targetObject = fieldDetails.get('referenceTo');
                if(String.isBlank(targetObject)) { throw new AuraHandledException('For a lookup field, you must tell me which object to look up to.'); }
                customField.referenceTo = targetObject.trim();
                customField.relationshipLabel = customField.label + 's (' + objectName.replaceAll('__c$','') + ')';
                customField.relationshipName = customField.label.replaceAll('[^a-zA-Z0-9]','');
            }
            when 'MasterDetail' {
                customField.type_x = 'MasterDetail';
                String targetObject = fieldDetails.get('referenceTo');
                if(String.isBlank(targetObject)) { 
                    throw new AuraHandledException('For a master-detail field, you must tell me which object to look up to.'); 
                }
                // Handle standard vs custom objects
                if (isStandardObject(targetObject)) {
                    customField.referenceTo = targetObject;
                } else {
                    customField.referenceTo = targetObject.endsWith('__c') ? targetObject : targetObject + '__c';
                }
                customField.relationshipLabel = customField.label + 's (' + objectName.replaceAll('__c$','') + ')';
                customField.relationshipName = customField.label.replaceAll('[^a-zA-Z0-9]','');
                // REQUIRED properties for Master-Detail
                customField.reparentableMasterDetail = true;
                customField.writeRequiresMasterRead = false;
                customField.relationshipOrder = 0;
                // Verify child object has no records (FIXED: Use correct object API name)
                String childObjectApiName = objectName; // Use the actual object name as parsed
                try {
                    String query = 'SELECT COUNT() FROM ' + childObjectApiName;
                    Integer count = (Integer)Database.countQuery(query);
                    if (count > 0) {
                        return 'Cannot create a Master-Detail field: The child object (' + childObjectApiName + ') already contains records. Please delete all records first.';
                    }
                } catch (Exception e) {
                    return 'Error checking child object records: ' + e.getMessage();
                }
                System.debug('Creating Master-Detail field with details:');
                System.debug('Full Name: ' + fullFieldName);
                System.debug('Reference To: ' + customField.referenceTo);
                System.debug('Relationship Name: ' + customField.relationshipName);
            }
            when 'Formula' {
                String returnType = fieldDetails.get('returnType');
                String formula = fieldDetails.get('formula');
                
                if(String.isBlank(returnType)) { 
                    throw new AuraHandledException('For a formula field, you must specify the return type. Format: "Add a formula field called [FieldName] to [ObjectName] that returns [Type] with formula [Expression]"'); 
                }
                if(String.isBlank(formula)) { 
                    throw new AuraHandledException('For a formula field, you must provide the formula expression. Format: "Add a formula field called [FieldName] to [ObjectName] that returns [Type] with formula [Expression]"'); 
                }
                
                // Set the field type based on the return type
                switch on returnType.toLowerCase() {
                    when 'text' {
                        customField.type_x = 'Text';
                        customField.length = 255;
                    }
                    when 'number' {
                        customField.type_x = 'Number';
                        Integer precision = String.isNotBlank(fieldDetails.get('precision')) ? Integer.valueOf(fieldDetails.get('precision')) : 18;
                        Integer scale = String.isNotBlank(fieldDetails.get('scale')) ? Integer.valueOf(fieldDetails.get('scale')) : 0;
                        customField.precision = precision;
                        customField.scale = scale;
                    }
                    when 'currency' {
                        customField.type_x = 'Currency';
                        Integer precision = String.isNotBlank(fieldDetails.get('precision')) ? Integer.valueOf(fieldDetails.get('precision')) : 18;
                        Integer scale = String.isNotBlank(fieldDetails.get('scale')) ? Integer.valueOf(fieldDetails.get('scale')) : 2;
                        customField.precision = precision;
                        customField.scale = scale;
                    }
                    when 'percent' {
                        customField.type_x = 'Percent';
                        Integer precision = String.isNotBlank(fieldDetails.get('precision')) ? Integer.valueOf(fieldDetails.get('precision')) : 18;
                        Integer scale = String.isNotBlank(fieldDetails.get('scale')) ? Integer.valueOf(fieldDetails.get('scale')) : 0;
                        customField.precision = precision;
                        customField.scale = scale;
                    }
                    when 'date' {
                        customField.type_x = 'Date';
                    }
                    when 'datetime' {
                        customField.type_x = 'DateTime';
                    }
                    when 'time' {
                        customField.type_x = 'Time';
                    }
                    when 'checkbox' {
                        customField.type_x = 'Checkbox';
                    }
                    when else {
                        customField.type_x = 'Text';
                        customField.length = 255;
                    }
                }
                
                // Add formula properties
                customField.formula = formula;
                customField.formulaTreatBlanksAs = 'BlankAsZero';
            }
            when else { 
                customField.type_x = 'Text'; customField.length = 255;
            }
        }

        if (fieldDetails.get('required') == 'true') {
            customField.required = true;
        }

        if (fieldDetails.containsKey('description')) {
            customField.description = fieldDetails.get('description');
        }

        List<MetadataService.SaveResult> results = service.createMetadata(new MetadataService.Metadata[] { customField });
        String fieldResult = processSaveResults(results, 'field');
        
        // After successful field creation, update page layouts to make field visible
        try {
            updatePageLayoutsForField(service, objectName, fieldName);
            return 'Field created successfully: ' + fieldName + ' on ' + objectName + '.';
        } catch (Exception layoutException) {
            return fieldResult + '\n\nField created successfully, but there was an issue updating page layouts: ' + layoutException.getMessage() + '\nTo make the field visible in tabs:\n1. Go to Setup > Object Manager > ' + objectName + ' > Page Layouts\n2. Click on the page layout (usually "' + objectName + ' Layout")\n3. Drag the "' + fieldName + '" field from the left panel to the desired location on the layout\n4. Save the page layout.';
        }
    }

    private static String createPicklistInTwoSteps(MetadataService.MetadataPort service, String objectName, String fieldName, String picklistValues) {
        // FIXED: Handle standard objects vs custom objects
        String fullFieldName;
        if (isStandardObject(objectName)) {
            // Standard objects don't need __c suffix
            fullFieldName = objectName + '.' + fieldName.trim().replaceAll(' ','_') + '__c';
        } else {
            // Custom objects need __c suffix
            fullFieldName = objectName.trim().replaceAll('__c$','') + '__c.' + fieldName.trim().replaceAll(' ','_') + '__c';
        }
        
        MetadataService.CustomField finalPicklistField = new MetadataService.CustomField();
        finalPicklistField.fullName = fullFieldName;
        finalPicklistField.label = fieldName.trim();
        finalPicklistField.type_x = 'Picklist';
        List<MetadataService.CustomValue> customValues = new List<MetadataService.CustomValue>();
        if(String.isNotBlank(picklistValues)) {
            for(String val : picklistValues.split(',')) {
                MetadataService.CustomValue cv = new MetadataService.CustomValue();
                cv.fullName = val.trim(); cv.default_x = false; cv.isActive = true; cv.label = val.trim();
                customValues.add(cv);
            }
        } else {
             throw new AuraHandledException('For a picklist, you must provide values.');
        }
        MetadataService.ValueSetValuesDefinition valueDefinition = new MetadataService.ValueSetValuesDefinition();
        valueDefinition.value = customValues; valueDefinition.sorted = false;
        MetadataService.ValueSet valueSet = new MetadataService.ValueSet();
        valueSet.valueSetDefinition = valueDefinition;
        finalPicklistField.valueSet = valueSet;
        List<MetadataService.SaveResult> results = service.createMetadata(new MetadataService.Metadata[] { finalPicklistField });
        return processSaveResults(results, 'picklist field');
    }

    private static String handleCreateObject(MetadataService.MetadataPort service, String instruction) {
        String objectName = parseObjectName(instruction);
        if(String.isBlank(objectName)) { return 'I could not figure out the object name.'; }
        MetadataService.CustomObject customObject = new MetadataService.CustomObject();
        customObject.fullName = objectName + '__c';
        customObject.label = objectName;
        customObject.pluralLabel = objectName + 's';
        MetadataService.CustomField nameField = new MetadataService.CustomField();
        nameField.type_x = 'Text';
        nameField.label = objectName + ' Name';
        customObject.nameField = nameField;
        customObject.deploymentStatus = 'Deployed';
        customObject.sharingModel = 'ReadWrite';
        List<MetadataService.SaveResult> results = service.createMetadata(new MetadataService.Metadata[] { customObject });
        return processSaveResults(results, 'object');
    }
    
    private static String processSaveResults(List<MetadataService.SaveResult> results, String metadataType) {
        for (MetadataService.SaveResult result : results) {
            if (result.success) {
                if (metadataType == 'role') {
                    return 'Role created with name ' + result.fullName;
                } else if (metadataType == 'profile') {
                    return 'Profile created with name ' + result.fullName;
                } else if (metadataType == 'object') {
                    return 'Object created with name ' + result.fullName;
                } else if (metadataType == 'field') {
                    return 'Field created with name ' + result.fullName;
                } else if (metadataType == 'record type') {
                    return 'Record type created with name ' + result.fullName;
                } else if (metadataType == 'picklist field') {
                    return 'Picklist field created with name ' + result.fullName;
                } else {
                    return 'Success: ' + result.fullName;
                }
            } else {
                String errors = '';
                if (result.errors != null) {
                    for(MetadataService.Error error : result.errors) { 
                        errors += error.message + ' '; 
                    }
                }
                // Instead of throwing, always return the error message for better reporting
                return 'Error with ' + metadataType + ' operation: ' + errors.trim();
            }
        }
        return 'The metadata operation did not return a result.';
    }

    private static Map<String, String> parseProfileDetails(String instruction) {
        Map<String, String> details = new Map<String, String>();
        String cleanInstruction = instruction.toLowerCase().trim();
        
        if (cleanInstruction.contains('called ') && cleanInstruction.contains(' by cloning ')) {
            Integer nameStartIndex = cleanInstruction.indexOf('called ') + 'called '.length();
            Integer nameEndIndex = cleanInstruction.indexOf(' by cloning ');
            String newProfileName = instruction.substring(nameStartIndex, nameEndIndex).trim();
            details.put('newProfileName', newProfileName);
            
            Integer sourceStartIndex = nameEndIndex + ' by cloning '.length();
            String sourceProfileName = instruction.substring(sourceStartIndex).trim();
            details.put('sourceProfileName', sourceProfileName);
        }
        return details;
    }

    private static Map<String, String> parseModificationDetails(String instruction) {
        Map<String, String> details = new Map<String, String>();
        String cleanInstruction = instruction.toLowerCase().trim();
        
        // Extract profile name - IMPROVED LOGIC
        if (cleanInstruction.contains('profile ')) {
            Integer profileStartIndex = cleanInstruction.indexOf('profile ') + 'profile '.length();
            String remainingText = instruction.substring(profileStartIndex).trim();
            
            // Find the end of the profile name (before the next action word)
            List<String> actionWords = new List<String>{'read', 'edit', 'access', 'make', 'allow', 'enable', 'disable'};
            Integer profileEndIndex = remainingText.length();
            
            for (String actionWord : actionWords) {
                Integer actionIndex = remainingText.indexOf(' ' + actionWord + ' ');
                if (actionIndex > 0 && actionIndex < profileEndIndex) {
                    profileEndIndex = actionIndex;
                }
            }
            
            if (profileEndIndex > 0) {
                String profileName = remainingText.substring(0, profileEndIndex).trim();
                details.put('profileName', profileName);
            }
        }
        
        // Determine modification type - IMPROVED LOGIC
        if (cleanInstruction.contains('access to ') && cleanInstruction.contains(' object')) {
            details.put('modificationType', 'objectPermission');
            
            // Extract object name and permission
            if (cleanInstruction.contains('read and edit access to ')) {
                details.put('permission', 'edit');
                Integer objectStartIndex = cleanInstruction.indexOf('read and edit access to ') + 'read and edit access to '.length();
                Integer objectEndIndex = cleanInstruction.indexOf(' object');
                if (objectEndIndex > objectStartIndex) {
                    String objectName = instruction.substring(objectStartIndex, objectEndIndex).trim();
                    details.put('objectName', objectName);
                }
            } else if (cleanInstruction.contains('read access to ')) {
                details.put('permission', 'read');
                Integer objectStartIndex = cleanInstruction.indexOf('read access to ') + 'read access to '.length();
                Integer objectEndIndex = cleanInstruction.indexOf(' object');
                if (objectEndIndex > objectStartIndex) {
                    String objectName = instruction.substring(objectStartIndex, objectEndIndex).trim();
                    details.put('objectName', objectName);
                }
            } else if (cleanInstruction.contains('edit access to ')) {
                details.put('permission', 'edit');
                Integer objectStartIndex = cleanInstruction.indexOf('edit access to ') + 'edit access to '.length();
                Integer objectEndIndex = cleanInstruction.indexOf(' object');
                if (objectEndIndex > objectStartIndex) {
                    String objectName = instruction.substring(objectStartIndex, objectEndIndex).trim();
                    details.put('objectName', objectName);
                }
            }
        } else if (cleanInstruction.contains('field on ') && cleanInstruction.contains(' for profile')) {
            details.put('modificationType', 'fieldPermission');
            // Extract field name, object name, and permission
            if (cleanInstruction.contains('make the ') && cleanInstruction.contains(' field on ')) {
                Integer fieldStartIndex = cleanInstruction.indexOf('make the ') + 'make the '.length();
                Integer fieldEndIndex = cleanInstruction.indexOf(' field on ');
                if (fieldEndIndex > fieldStartIndex) {
                    String fieldName = instruction.substring(fieldStartIndex, fieldEndIndex).trim();
                    details.put('fieldName', fieldName);
                }
                
                Integer objectStartIndex = cleanInstruction.indexOf(' field on ') + ' field on '.length();
                Integer objectEndIndex = cleanInstruction.indexOf(' for profile');
                if (objectEndIndex > objectStartIndex) {
                    String objectName = instruction.substring(objectStartIndex, objectEndIndex).trim();
                    details.put('objectName', objectName);
                }
                
                if (cleanInstruction.contains('read-only')) {
                    details.put('permission', 'read-only');
                } else if (cleanInstruction.contains('hidden')) {
                    details.put('permission', 'hidden');
                } else if (cleanInstruction.contains('editable')) {
                    details.put('permission', 'editable');
                }
            }
        } else if (cleanInstruction.contains('access apex class ')) {
            details.put('modificationType', 'classAccess');
            // Extract class name
            Integer classStartIndex = cleanInstruction.indexOf('access apex class ') + 'access apex class '.length();
            String className = instruction.substring(classStartIndex).trim();
            details.put('className', className);
            details.put('access', 'allow');
        } else if (cleanInstruction.contains('permission for profile')) {
            details.put('modificationType', 'systemPermission');
            // Extract permission name and action
            if (cleanInstruction.startsWith('enable ')) {
                details.put('action', 'enable');
                Integer permStartIndex = cleanInstruction.indexOf('enable ') + 'enable '.length();
                Integer permEndIndex = cleanInstruction.indexOf(' permission for profile');
                if (permEndIndex > permStartIndex) {
                    String permission = instruction.substring(permStartIndex, permEndIndex).trim();
                    details.put('permission', permission);
                }
            } else if (cleanInstruction.startsWith('disable ')) {
                details.put('action', 'disable');
                Integer permStartIndex = cleanInstruction.indexOf('disable ') + 'disable '.length();
                Integer permEndIndex = cleanInstruction.indexOf(' permission for profile');
                if (permEndIndex > permStartIndex) {
                    String permission = instruction.substring(permStartIndex, permEndIndex).trim();
                    details.put('permission', permission);
                }
            }
        }
        
        return details;
    }

    private static Map<String, String> parseRoleDetails(String instruction) {
        Map<String, String> details = new Map<String, String>();
        String cleanInstruction = instruction.toLowerCase().trim();
        String nameKeyword = 'called ';
        String parentKeyword = ' that reports to ';

        if (cleanInstruction.contains(nameKeyword)) {
            Integer nameStartIndex = cleanInstruction.indexOf(nameKeyword) + nameKeyword.length();
            String roleLabel;
            
            if (cleanInstruction.contains(parentKeyword)) {
                Integer nameEndIndex = cleanInstruction.indexOf(parentKeyword);
                roleLabel = instruction.substring(nameStartIndex, nameEndIndex).trim();
                
                Integer parentStartIndex = nameEndIndex + parentKeyword.length();
                String parentRoleLabel = instruction.substring(parentStartIndex).trim();
                details.put('parentRole', parentRoleLabel);
            } else {
                roleLabel = instruction.substring(nameStartIndex).trim();
                details.put('parentRole', '');
            }
            
            details.put('roleLabel', roleLabel);
            details.put('roleName', roleLabel.replaceAll('[^a-zA-Z0-9]+', '_'));
        }
        return details;
    }

    private static Map<String, String> parseFieldDetails(String instruction) {
        Map<String, String> details = new Map<String, String>();
        String cleanInstruction = instruction.toLowerCase().trim();
        
        // Field type parsing
        if (cleanInstruction.contains('lookup relationship field')) { details.put('fieldType', 'Lookup'); }
        else if (
            cleanInstruction.contains('master detail relationship field') ||
            cleanInstruction.contains('master-detail relationship field') ||
            cleanInstruction.contains('master detail field') ||
            cleanInstruction.contains('master-detail field')
        ) { details.put('fieldType', 'MasterDetail'); }
        else if (cleanInstruction.contains('long text area field')) { details.put('fieldType', 'LongTextArea'); }
        else if (cleanInstruction.contains('rich text area field')) { details.put('fieldType', 'Html'); }
        else if (cleanInstruction.contains('text area field')) { details.put('fieldType', 'TextArea'); }
        else if (cleanInstruction.contains('date/time field')) { details.put('fieldType', 'DateTime'); }
        else if (cleanInstruction.contains('picklist field')) { details.put('fieldType', 'Picklist'); }
        else if (cleanInstruction.contains('currency field')) { details.put('fieldType', 'Currency'); }
        else if (cleanInstruction.contains('checkbox field')) { details.put('fieldType', 'Checkbox'); }
        else if (cleanInstruction.contains('number field')) { details.put('fieldType', 'Number'); }
        else if (cleanInstruction.contains('percent field')) { details.put('fieldType', 'Percent'); }
        else if (cleanInstruction.contains('phone field')) { details.put('fieldType', 'Phone'); }
        else if (cleanInstruction.contains('email field')) { details.put('fieldType', 'Email'); }
        else if (cleanInstruction.contains('date field')) { details.put('fieldType', 'Date'); }
        else if (cleanInstruction.contains('time field')) { details.put('fieldType', 'Time'); }
        else if (cleanInstruction.contains('url field')) { details.put('fieldType', 'Url'); }
        else if (cleanInstruction.contains('formula field')) { details.put('fieldType', 'Formula'); }
        else { details.put('fieldType', 'Text'); }
        
        System.debug('parseFieldDetails: fieldType=' + details.get('fieldType') + ', instruction=' + instruction);
        
        // Field Name parsing
        if (cleanInstruction.contains('called ')) {
            Integer startIndex = cleanInstruction.indexOf('called ') + 'called '.length();
            Integer endIndex = cleanInstruction.indexOf(' to ');
            if(endIndex > startIndex) { 
                details.put('fieldName', cleanInstruction.substring(startIndex, endIndex).trim()); 
            }
        }
        
        // Object Name parsing - FIXED: Extract the exact object name without modification
        if (cleanInstruction.contains(' to ')) {
            Integer startIndex = cleanInstruction.indexOf(' to ') + ' to '.length();
            String remainingText = cleanInstruction.substring(startIndex).trim();
            // Take the first word as the object name
            String objectName = remainingText.split(' ')[0].trim();
            // Convert to proper case for standard objects
            if (objectName.equals('account')) objectName = 'Account';
            else if (objectName.equals('contact')) objectName = 'Contact';
            else if (objectName.equals('lead')) objectName = 'Lead';
            else if (objectName.equals('opportunity')) objectName = 'Opportunity';
            else if (objectName.equals('case')) objectName = 'Case';
            else if (objectName.equals('user')) objectName = 'User';
            else if (objectName.equals('campaign')) objectName = 'Campaign';
            else if (objectName.equals('task')) objectName = 'Task';
            else if (objectName.equals('event')) objectName = 'Event';
            else if (objectName.equals('note')) objectName = 'Note';
            else if (objectName.equals('attachment')) objectName = 'Attachment';
            else if (objectName.equals('solution')) objectName = 'Solution';
            else if (objectName.equals('article')) objectName = 'Article';
            else if (objectName.equals('topic')) objectName = 'Topic';
            else if (objectName.equals('vote')) objectName = 'Vote';
            else if (objectName.equals('idea')) objectName = 'Idea';
            else if (objectName.equals('asset')) objectName = 'Asset';
            else if (objectName.equals('contract')) objectName = 'Contract';
            else if (objectName.equals('order')) objectName = 'Order';
            else if (objectName.equals('product2')) objectName = 'Product2';
            else if (objectName.equals('pricebook2')) objectName = 'Pricebook2';
            else if (objectName.equals('pricebookentry')) objectName = 'PricebookEntry';
            else if (objectName.equals('group')) objectName = 'Group';
            else if (objectName.equals('queue')) objectName = 'Queue';
            else if (objectName.equals('feeditem')) objectName = 'FeedItem';
            else if (objectName.equals('feedcomment')) objectName = 'FeedComment';
            else if (objectName.equals('collaborationgroup')) objectName = 'CollaborationGroup';
            else if (objectName.equals('collaborationgroupmember')) objectName = 'CollaborationGroupMember';
            else if (objectName.equals('ideacomment')) objectName = 'IdeaComment';
            else if (objectName.equals('knowledgearticleversion')) objectName = 'KnowledgeArticleVersion';
            else if (objectName.equals('topicassignment')) objectName = 'TopicAssignment';
            else if (objectName.equals('entitysubscription')) objectName = 'EntitySubscription';
            else if (objectName.equals('userrole')) objectName = 'UserRole';
            else if (objectName.equals('profile')) objectName = 'Profile';
            else if (objectName.equals('permissionset')) objectName = 'PermissionSet';
            else if (objectName.equals('permissionsetassignment')) objectName = 'PermissionSetAssignment';
            else if (objectName.equals('customobject')) objectName = 'CustomObject';
            else if (objectName.equals('customfield')) objectName = 'CustomField';
            else if (objectName.equals('apexclass')) objectName = 'ApexClass';
            else if (objectName.equals('apextrigger')) objectName = 'ApexTrigger';
            else if (objectName.equals('apexpage')) objectName = 'ApexPage';
            else if (objectName.equals('apexcomponent')) objectName = 'ApexComponent';
            else if (objectName.equals('staticresource')) objectName = 'StaticResource';
            else if (objectName.equals('document')) objectName = 'Document';
            else if (objectName.equals('emailtemplate')) objectName = 'EmailTemplate';
            else if (objectName.equals('letterhead')) objectName = 'Letterhead';
            else if (objectName.equals('folder')) objectName = 'Folder';
            else if (objectName.equals('report')) objectName = 'Report';
            else if (objectName.equals('dashboard')) objectName = 'Dashboard';
            else if (objectName.equals('listview')) objectName = 'ListView';
            else if (objectName.equals('customtab')) objectName = 'CustomTab';
            else if (objectName.equals('customapplication')) objectName = 'CustomApplication';
            else if (objectName.equals('validationrule')) objectName = 'ValidationRule';
            else if (objectName.equals('workflowrule')) objectName = 'WorkflowRule';
            else if (objectName.equals('workflowfieldupdate')) objectName = 'WorkflowFieldUpdate';
            else if (objectName.equals('workflowalert')) objectName = 'WorkflowAlert';
            else if (objectName.equals('workflowtask')) objectName = 'WorkflowTask';
            else if (objectName.equals('processbuilder')) objectName = 'ProcessBuilder';
            else if (objectName.equals('flow')) objectName = 'Flow';
            else if (objectName.equals('approvalprocess')) objectName = 'ApprovalProcess';
            else if (objectName.equals('assignmentrule')) objectName = 'AssignmentRule';
            else if (objectName.equals('autoresponserule')) objectName = 'AutoResponseRule';
            else if (objectName.equals('escalationrule')) objectName = 'EscalationRule';
            else if (objectName.equals('sharingrule')) objectName = 'SharingRule';
            else if (objectName.equals('sharingownerrule')) objectName = 'SharingOwnerRule';
            else if (objectName.equals('sharingcriteriarule')) objectName = 'SharingCriteriaRule';
            else if (objectName.equals('sharingterritoryrule')) objectName = 'SharingTerritoryRule';
            else if (objectName.equals('sharingguestrule')) objectName = 'SharingGuestRule';
            else if (objectName.equals('territory')) objectName = 'Territory';
            else if (objectName.equals('territory2')) objectName = 'Territory2';
            else if (objectName.equals('territory2model')) objectName = 'Territory2Model';
            else if (objectName.equals('territory2type')) objectName = 'Territory2Type';
            else if (objectName.equals('territory2rule')) objectName = 'Territory2Rule';
            else if (objectName.equals('territory2ruleitem')) objectName = 'Territory2RuleItem';
            else if (objectName.equals('territory2ruleassociation')) objectName = 'Territory2RuleAssociation';
            
            details.put('objectName', objectName);
        }
        
        // Parameter parsing for specific types
        if (details.get('fieldType') == 'Number' || details.get('fieldType') == 'Percent') {
            if (cleanInstruction.contains('with ') && cleanInstruction.contains(' digits')) { 
                details.put('precision', cleanInstruction.substring(cleanInstruction.indexOf('with ') + 'with '.length(), cleanInstruction.indexOf(' digits')).trim()); 
            }
            if (cleanInstruction.contains('and ') && cleanInstruction.contains(' decimals')) { 
                details.put('scale', cleanInstruction.substring(cleanInstruction.indexOf('and ') + 'and '.length(), cleanInstruction.indexOf(' decimals')).trim()); 
            }
        }
        
        if (details.get('fieldType') == 'LongTextArea' || details.get('fieldType') == 'Html') {
            if (cleanInstruction.contains('with length ')) { 
                details.put('length', cleanInstruction.substring(cleanInstruction.indexOf('with length ') + 'with length '.length()).split(' ')[0].trim()); 
            }
            if (cleanInstruction.contains('and ') && cleanInstruction.contains(' visible lines')) { 
                details.put('visibleLines', cleanInstruction.substring(cleanInstruction.indexOf('and ') + 'and '.length(), cleanInstruction.indexOf(' visible lines')).trim()); 
            }
        }
        
        if(details.get('fieldType') == 'Lookup' || details.get('fieldType') == 'MasterDetail') {
            if(cleanInstruction.contains('that looks up to ')) { 
                String refObj = cleanInstruction.substring(cleanInstruction.indexOf('that looks up to ') + 'that looks up to '.length()).split(' ')[0].trim();
                // Normalize standard object names
                if (refObj.equalsIgnoreCase('account')) refObj = 'Account';
                else if (refObj.equalsIgnoreCase('contact')) refObj = 'Contact';
                else if (refObj.equalsIgnoreCase('user')) refObj = 'User';
                else if (refObj.equalsIgnoreCase('lead')) refObj = 'Lead';
                else if (refObj.equalsIgnoreCase('opportunity')) refObj = 'Opportunity';
                else if (refObj.equalsIgnoreCase('case')) refObj = 'Case';
                else if (refObj.equalsIgnoreCase('campaign')) refObj = 'Campaign';
                else if (refObj.equalsIgnoreCase('product2')) refObj = 'Product2';
                // Add more as needed
                details.put('referenceTo', refObj);
            }
        }
        
        if (details.get('fieldType') == 'Picklist' && cleanInstruction.contains('with values ')) {
            details.put('picklistValues', cleanInstruction.substring(cleanInstruction.indexOf('with values ') + 'with values '.length()));
        }
        
        // Formula field parsing
        if (details.get('fieldType') == 'Formula') {
            // Parse return type
            if (cleanInstruction.contains(' that returns ')) {
                String returnTypeText = cleanInstruction.substring(cleanInstruction.indexOf(' that returns ') + ' that returns '.length());
                if (returnTypeText.contains(' with formula ')) {
                    String returnType = returnTypeText.substring(0, returnTypeText.indexOf(' with formula ')).trim();
                    details.put('returnType', returnType);
                    
                    // Parse formula expression
                    String formulaText = returnTypeText.substring(returnTypeText.indexOf(' with formula ') + ' with formula '.length());
                    if (formulaText.contains('"') && formulaText.lastIndexOf('"') > formulaText.indexOf('"')) {
                        String formula = formulaText.substring(formulaText.indexOf('"') + 1, formulaText.lastIndexOf('"'));
                        details.put('formula', formula);
                    } else {
                        // If no quotes, take everything after "with formula"
                        details.put('formula', formulaText);
                    }
                } else {
                    details.put('returnType', returnTypeText);
                }
            }
            
            // Parse precision and scale for numeric formulas
            if ((details.get('returnType') == 'Number' || details.get('returnType') == 'Currency' || details.get('returnType') == 'Percent') && 
                cleanInstruction.contains(' with ') && cleanInstruction.contains(' digits')) {
                details.put('precision', cleanInstruction.substring(cleanInstruction.indexOf(' with ') + ' with '.length(), cleanInstruction.indexOf(' digits')).trim());
            }
            if ((details.get('returnType') == 'Number' || details.get('returnType') == 'Currency' || details.get('returnType') == 'Percent') && 
                cleanInstruction.contains(' and ') && cleanInstruction.contains(' decimals')) {
                details.put('scale', cleanInstruction.substring(cleanInstruction.indexOf(' and ') + ' and '.length(), cleanInstruction.indexOf(' decimals')).trim());
            }
        }
        
        if (cleanInstruction.contains(' required')) {
            details.put('required', 'true');
        }
        
        // Parse description
        if (cleanInstruction.contains('with description ')) {
            Integer descStart = cleanInstruction.indexOf('with description ') + 'with description '.length();
            String description = instruction.substring(descStart).trim();
            details.put('description', description);
        } else if (cleanInstruction.contains('and description ')) {
            Integer descStart = cleanInstruction.indexOf('and description ') + 'and description '.length();
            String description = instruction.substring(descStart).trim();
            details.put('description', description);
        }
        
        // Parse length for text fields
        if (details.get('fieldType') == 'Text' && cleanInstruction.contains('with length ')) {
            Integer lenStart = cleanInstruction.indexOf('with length ') + 'with length '.length();
            String lenStr = cleanInstruction.substring(lenStart).split(' ')[0].trim();
            details.put('length', lenStr);
        }
        
        return details;
    }

    private static String parseObjectName(String instruction) {
        String cleanInstruction = instruction.toLowerCase();
        String keyword = 'object called ';
        if(cleanInstruction.contains(keyword)) { return cleanInstruction.substring(cleanInstruction.indexOf(keyword) + keyword.length()).trim().split(' ')[0];}
        keyword = 'object ';
        if(cleanInstruction.contains(keyword)) { return cleanInstruction.substring(cleanInstruction.indexOf(keyword) + keyword.length()).trim().split(' ')[0];}
        return null;
    }

    private static MetadataService.MetadataPort createService(String sessionId) {
        MetadataService.MetadataPort service = new MetadataService.MetadataPort();
        service.SessionHeader = new MetadataService.SessionHeader_element();
        service.SessionHeader.sessionId = sessionId;
        return service;
    }

    private static String getSessionId(String username, String password) {
        String endpoint = URL.getOrgDomainUrl().toExternalForm() + '/services/Soap/u/60.0';
        String soapBody = '<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com"><soapenv:Header/><soapenv:Body><urn:login><urn:username>' + username + '</urn:username><urn:password>' + password + '</urn:password></urn:login></soapenv:Body></soapenv:Envelope>';
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setHeader('Content-Type', 'text/xml;charset=UTF-8');
        req.setHeader('SOAPAction', '""');
        req.setBody(soapBody);
        req.setMethod('POST');
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() == 200) {
            Dom.Document doc = new Dom.Document();
            doc.load(res.getBody());
            Dom.XMLNode root = doc.getRootElement();
            return root.getChildElement('Body', 'http://schemas.xmlsoap.org/soap/envelope/').getChildElement('loginResponse', 'urn:partner.soap.sforce.com').getChildElement('result', 'urn:partner.soap.sforce.com').getChildElement('sessionId', 'urn:partner.soap.sforce.com').getText();
        }
        return null;
    }

    // NEW: Helper method to identify standard objects
    private static Boolean isStandardObject(String objectName) {
        Set<String> standardObjects = new Set<String>{
            'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'User', 'Group', 'Queue',
            'Campaign', 'Asset', 'Contract', 'Order', 'Product2', 'Pricebook2', 'PricebookEntry',
            'Task', 'Event', 'Note', 'Attachment', 'ContentDocument', 'ContentVersion',
            'FeedItem', 'FeedComment', 'CollaborationGroup', 'CollaborationGroupMember',
            'Vote', 'Idea', 'IdeaComment', 'Solution', 'Article', 'KnowledgeArticleVersion',
            'Topic', 'TopicAssignment', 'EntitySubscription', 'UserRole', 'Profile',
            'PermissionSet', 'PermissionSetAssignment', 'CustomObject', 'CustomField',
            'ApexClass', 'ApexTrigger', 'ApexPage', 'ApexComponent', 'StaticResource',
            'Document', 'EmailTemplate', 'Letterhead', 'Folder', 'Report', 'Dashboard',
            'ListView', 'CustomTab', 'CustomApplication', 'CustomObject', 'CustomField',
            'ValidationRule', 'WorkflowRule', 'WorkflowFieldUpdate', 'WorkflowAlert',
            'WorkflowTask', 'ProcessBuilder', 'Flow', 'ApprovalProcess', 'AssignmentRule',
            'AutoResponseRule', 'EscalationRule', 'SharingRule', 'SharingOwnerRule',
            'SharingCriteriaRule', 'SharingTerritoryRule', 'SharingGuestRule',
            'Territory', 'Territory2', 'Territory2Model', 'Territory2Type',
            'Territory2Rule', 'Territory2RuleItem', 'Territory2RuleAssociation'
        };
        return standardObjects.contains(objectName);
    }

    private static void updatePageLayoutsForField(MetadataService.MetadataPort service, String objectName, String fieldName) {
        try {
            System.debug('Updating page layouts for field: ' + fieldName + ' on object: ' + objectName);
            
            // Determine the object API name
            String objectApiName;
            if (isStandardObject(objectName)) {
                objectApiName = objectName;
            } else {
                objectApiName = objectName.trim().replaceAll('__c$','') + '__c';
            }
            
            // Get the field API name
            String fieldApiName = fieldName.trim().replaceAll(' ','_') + '__c';
            
            // For now, provide instructions to manually add the field to page layouts
            // This is more reliable than trying to programmatically update layouts
            System.debug('Field created successfully. Please manually add the field to page layouts in Setup.');
            
        } catch (Exception e) {
            System.debug('Error in page layout update: ' + e.getMessage());
            // Don't throw exception here as field creation was successful
        }
    }

    // Handler for creating a record type
    private static String handleCreateRecordType(MetadataService.MetadataPort service, String instruction) {
        Map<String, String> details = parseRecordTypeDetails(instruction);
        String objectName = details.get('objectName');
        String recordTypeName = details.get('recordTypeName');
        String label = details.get('label');
        String description = details.get('description');
        Boolean active = details.containsKey('active') ? Boolean.valueOf(details.get('active')) : true;

        if (String.isBlank(objectName) || String.isBlank(recordTypeName) || String.isBlank(label)) {
            return 'Error: Could not parse object name, record type name, or label from your instruction.';
        }

        try {
            // For standard objects, use the exact name without modification
            String objectApiName = isStandardObject(objectName) ? objectName : (objectName.endsWith('__c') ? objectName : objectName + '__c');
            String fullName = objectApiName + '.' + recordTypeName;

            System.debug('Creating record type with fullName: ' + fullName);
            System.debug('Object API Name: ' + objectApiName);
            System.debug('Record Type Name: ' + recordTypeName);
            System.debug('Label: ' + label);
            System.debug('Description: ' + description);
            System.debug('Active: ' + active);

            // Create the record type metadata
            MetadataService.RecordType recordType = new MetadataService.RecordType();
            recordType.fullName = fullName;
            recordType.label = label;
            recordType.description = description;
            recordType.active = active;

            List<MetadataService.SaveResult> results = service.createMetadata(new MetadataService.Metadata[] { recordType });
            return processSaveResults(results, 'record type');
        } catch (Exception e) {
            return 'Error creating record type: ' + e.getMessage() + '\nStack trace: ' + e.getStackTraceString();
        }
    }

    // Parser for record type details
    private static Map<String, String> parseRecordTypeDetails(String instruction) {
        Map<String, String> details = new Map<String, String>();
        // Normalize whitespace and remove line breaks
        String normalized = instruction.replace('\n', ' ').replace('\r', ' ').replaceAll(' +', ' ').trim();
        String cleanInstruction = normalized.toLowerCase();
        // Example: Create a record type called SalesType on Account with label Sales and description For sales team active
        if (cleanInstruction.contains('called ') && cleanInstruction.contains(' on ')) {
            Integer nameStart = cleanInstruction.indexOf('called ') + 'called '.length();
            Integer nameEnd = cleanInstruction.indexOf(' on ');
            if (nameEnd <= nameStart) {
                System.debug('parseRecordTypeDetails: Could not parse recordTypeName.');
                return details;
            }
            String recordTypeName = normalized.substring(nameStart, nameEnd).trim();
            details.put('recordTypeName', recordTypeName.replaceAll('[^a-zA-Z0-9_]', ''));
            Integer objStart = nameEnd + ' on '.length();
            String afterObj = normalized.substring(objStart);
            String[] objParts = afterObj.split(' ');
            if (objParts.size() > 0) {
                details.put('objectName', objParts[0].replaceAll('[^a-zA-Z0-9_]', ''));
            }
            // Label
            if (cleanInstruction.contains('with label ')) {
                Integer labelStart = cleanInstruction.indexOf('with label ') + 'with label '.length();
                Integer labelEnd = cleanInstruction.indexOf(' and description ');
                if (labelEnd == -1) {
                    // If 'and description' is missing, take the rest of the string
                    String label = normalized.substring(labelStart).trim();
                    details.put('label', label);
                } else if (labelEnd > labelStart) {
                    details.put('label', normalized.substring(labelStart, labelEnd).trim());
                }
            }
            // Description
            if (cleanInstruction.contains('and description ')) {
                Integer descStart = cleanInstruction.indexOf('and description ') + 'and description '.length();
                Integer descEnd = normalized.length();
                if (cleanInstruction.contains(' active')) {
                    descEnd = cleanInstruction.indexOf(' active');
                    details.put('active', 'true');
                } else if (cleanInstruction.contains(' inactive')) {
                    descEnd = cleanInstruction.indexOf(' inactive');
                    details.put('active', 'false');
                }
                details.put('description', normalized.substring(descStart, descEnd).trim());
            }
        }
        System.debug('parseRecordTypeDetails: recordTypeName=' + details.get('recordTypeName') + ', objectName=' + details.get('objectName') + ', label=' + details.get('label') + ', description=' + details.get('description') + ', active=' + details.get('active'));
        return details;
    }

    // Helper method to get profile display name from Metadata API
    private static String getProfileDisplayName(MetadataService.MetadataPort service, String profileApiName) {
        try {
            MetadataService.ReadProfileResult readResult = (MetadataService.ReadProfileResult) service.readMetadata('Profile', new String[] { profileApiName });
            if (readResult != null && readResult.records != null && !readResult.records.isEmpty()) {
                return readResult.records[0].fullName;
            }
        } catch (Exception e) {
            System.debug('Error getting profile display name: ' + e.getMessage());
        }
        return profileApiName;
    }

    // Enhanced profile resolution with display name support
    private static String getProfileApiName(String labelOrApiName) {
        if (String.isBlank(labelOrApiName)) {
            return null;
        }
        
        System.debug('Looking for profile: ' + labelOrApiName);
        
        // Try to find by API name first (exact match)
        List<Profile> profiles = [SELECT Name FROM Profile WHERE Name = :labelOrApiName LIMIT 1];
        if (!profiles.isEmpty()) {
            System.debug('Found profile by API name: ' + profiles[0].Name);
            return profiles[0].Name;
        }
        
        // Try case-insensitive search by API name
        profiles = [SELECT Name FROM Profile WHERE Name LIKE :('%' + labelOrApiName + '%') LIMIT 10];
        if (!profiles.isEmpty()) {
            for (Profile p : profiles) {
                if (p.Name.equalsIgnoreCase(labelOrApiName)) {
                    System.debug('Found profile by case-insensitive API name: ' + p.Name);
                    return p.Name;
                }
            }
        }
        
        // If still not found, try to find the most common profiles
        List<String> commonProfiles = new List<String>{
            'System Administrator', 'Standard User', 'Standard Platform User', 
            'Read Only', 'Marketing User', 'Contract Manager', 'Solution Manager'
        };
        
        for (String commonProfile : commonProfiles) {
            if (labelOrApiName.equalsIgnoreCase(commonProfile)) {
                profiles = [SELECT Name FROM Profile WHERE Name = :commonProfile LIMIT 1];
                if (!profiles.isEmpty()) {
                    System.debug('Found common profile: ' + profiles[0].Name);
                    return profiles[0].Name;
                }
            }
        }
        
        // Log all available profiles for debugging
        List<Profile> allProfiles = [SELECT Name FROM Profile ORDER BY Name LIMIT 50];
        System.debug('Available profiles:');
        for (Profile p : allProfiles) {
            System.debug('  API Name: ' + p.Name);
        }
        
        System.debug('Profile not found: ' + labelOrApiName);
        return null;
    }

    @AuraEnabled
    public static String listAvailableProfiles() {
        try {
            List<Profile> profiles = [SELECT Name, UserLicense.Name, UserType 
                                     FROM Profile 
                                     ORDER BY Name 
                                     LIMIT 100];
            
            List<String> profileInfo = new List<String>();
            profileInfo.add('Available Profiles for Cloning:');
            profileInfo.add('================================');
            profileInfo.add('');
            
            // Separate profiles by cloneability status
            List<String> cloneableProfiles = new List<String>();
            List<String> restrictedProfiles = new List<String>();
            List<String> nonCloneableProfiles = new List<String>();
            
            for (Profile p : profiles) {
                String cloneabilityStatus = checkProfileCloneability(p.Name);
                String profileLine = p.Name + ' (License: ' + p.UserLicense.Name + ', Type: ' + p.UserType + ')';
                
                if (cloneabilityStatus == 'CLONEABLE') {
                    cloneableProfiles.add('✅ ' + profileLine + ' - FULLY CLONEABLE');
                } else if (cloneabilityStatus == 'CLONEABLE_WITH_RESTRICTIONS') {
                    restrictedProfiles.add('⚠️ ' + profileLine + ' - CLONEABLE WITH RESTRICTIONS');
                } else {
                    nonCloneableProfiles.add('❌ ' + profileLine + ' - ' + cloneabilityStatus);
                }
            }
            
            // Add fully cloneable profiles first
            if (!cloneableProfiles.isEmpty()) {
                profileInfo.add('✅ FULLY CLONEABLE PROFILES:');
                profileInfo.add('===========================');
                for (String profile : cloneableProfiles) {
                    profileInfo.add(profile);
                }
                profileInfo.add('');
            }
            
            // Add profiles with restrictions
            if (!restrictedProfiles.isEmpty()) {
                profileInfo.add('⚠️ CLONEABLE WITH RESTRICTIONS:');
                profileInfo.add('===============================');
                for (String profile : restrictedProfiles) {
                    profileInfo.add(profile);
                }
                profileInfo.add('');
            }
            
            // Add non-cloneable profiles
            if (!nonCloneableProfiles.isEmpty()) {
                profileInfo.add('❌ NON-CLONEABLE PROFILES:');
                profileInfo.add('===========================');
                for (String profile : nonCloneableProfiles) {
                    profileInfo.add(profile);
                }
                profileInfo.add('');
            }
            
            // Add summary
            profileInfo.add('SUMMARY:');
            profileInfo.add('========');
            profileInfo.add('Fully cloneable profiles: ' + cloneableProfiles.size());
            profileInfo.add('Profiles with restrictions: ' + restrictedProfiles.size());
            profileInfo.add('Non-cloneable profiles: ' + nonCloneableProfiles.size());
            profileInfo.add('Total profiles: ' + profiles.size());
            profileInfo.add('');
            profileInfo.add('💡 TIPS:');
            profileInfo.add('- ✅ Use fully cloneable profiles for best results');
            profileInfo.add('- ⚠️ Profiles with restrictions may require special licenses');
            profileInfo.add('- ❌ Non-cloneable profiles cannot be used as source');
            
            return String.join(profileInfo, '\n');
            
        } catch (Exception e) {
            return 'Error listing profiles: ' + e.getMessage();
        }
    }

    @AuraEnabled
    public static String debugProfileResolution(String profileName) {
        try {
            System.debug('Debugging profile resolution for: ' + profileName);
            
            // Check if profile exists by exact name
            List<Profile> exactMatches = [SELECT Name, UserLicense.Name FROM Profile WHERE Name = :profileName LIMIT 1];
            if (!exactMatches.isEmpty()) {
                return '✓ Profile found by exact match: ' + exactMatches[0].Name + ' (License: ' + exactMatches[0].UserLicense.Name + ')';
            }
            
            // Check for partial matches
            List<Profile> partialMatches = [SELECT Name, UserLicense.Name FROM Profile WHERE Name LIKE :('%' + profileName + '%') LIMIT 10];
            if (!partialMatches.isEmpty()) {
                String result = '❌ Exact match not found, but found similar profiles:\n';
                for (Profile p : partialMatches) {
                    result += '  - ' + p.Name + ' (License: ' + p.UserLicense.Name + ')\n';
                }
                return result;
            }
            
            // Show all available profiles
            List<Profile> allProfiles = [SELECT Name, UserLicense.Name FROM Profile ORDER BY Name LIMIT 20];
            String result = '❌ Profile "' + profileName + '" not found. Available profiles:\n';
            for (Profile p : allProfiles) {
                result += '  - ' + p.Name + ' (License: ' + p.UserLicense.Name + ')\n';
            }
            return result;
            
        } catch (Exception e) {
            return 'Error debugging profile: ' + e.getMessage();
        }
    }

    @AuraEnabled
    public static String suggestCloneableProfiles() {
        try {
            List<Profile> profiles = [SELECT Name, UserLicense.Name, UserType FROM Profile ORDER BY Name];
            
            List<String> cloneableProfiles = new List<String>();
            List<String> restrictedProfiles = new List<String>();
            List<String> nonCloneableProfiles = new List<String>();
            
            for (Profile p : profiles) {
                String cloneability = checkProfileCloneability(p.Name);
                if (cloneability == 'CLONEABLE') {
                    cloneableProfiles.add(p.Name + ' (License: ' + p.UserLicense.Name + ')');
                } else if (cloneability == 'CLONEABLE_WITH_RESTRICTIONS') {
                    restrictedProfiles.add(p.Name + ' (License: ' + p.UserLicense.Name + ')');
                } else {
                    nonCloneableProfiles.add(p.Name + ' (License: ' + p.UserLicense.Name + ')');
                }
            }
            
            List<String> suggestions = new List<String>();
            suggestions.add('=== CLONEABLE PROFILES (Recommended) ===');
            suggestions.add('These profiles are confirmed to work with cloning:');
            for (String profile : cloneableProfiles) {
                suggestions.add('✓ ' + profile);
            }
            
            suggestions.add('');
            suggestions.add('=== CLONEABLE WITH RESTRICTIONS ===');
            suggestions.add('These profiles may work but have special requirements:');
            for (String profile : restrictedProfiles) {
                suggestions.add('⚠️ ' + profile);
            }
            
            suggestions.add('');
            suggestions.add('=== NOT CLONEABLE ===');
            suggestions.add('These profiles cannot be cloned due to license restrictions:');
            for (String profile : nonCloneableProfiles) {
                suggestions.add('❌ ' + profile);
            }
            
            suggestions.add('');
            suggestions.add('💡 RECOMMENDATION: Use "Standard User" or "System Administrator" as source profiles for best results.');
            suggestions.add('');
            suggestions.add('Usage Examples:');
            suggestions.add('===============');
            suggestions.add('Create a profile called SalesProfile by cloning Standard User');
            suggestions.add('Create a profile called MarketingProfile by cloning Marketing User');
            suggestions.add('Create a profile called AdminProfile by cloning System Administrator');
            suggestions.add('Create a profile called ReadOnlyProfile by cloning Read Only');
            
            return String.join(suggestions, '\n');
            
        } catch (Exception e) {
            return 'Error getting suggestions: ' + e.getMessage();
        }
    }

    /**
     * Handle profile cloning requests
     */
    private static String handleCloneProfiles(MetadataService.MetadataPort service, String instruction) {
        String cleanInstruction = instruction.toLowerCase().trim();
        
        if (cleanInstruction.contains('all profiles') || cleanInstruction.contains('clone all')) {
            return startBulkProfileCloning(service);
        } else if (cleanInstruction.contains('clone profile')) {
            return cloneSingleProfile(service, instruction);
        } else {
            return 'Please specify "clone all profiles" or "clone profile [ProfileName]"';
        }
    }

    /**
     * Start bulk profile cloning process
     */
    private static String startBulkProfileCloning(MetadataService.MetadataPort service) {
        try {
            List<ProfileCloneInfo> allProfiles = getAllProfilesForCloning();
            
            if (allProfiles.isEmpty()) {
                return 'No profiles found to clone.';
            }
            
            List<String> results = new List<String>();
            results.add('🚀 Starting bulk profile cloning process...');
            results.add('Found ' + allProfiles.size() + ' profiles to attempt cloning.');
            results.add('Attempting to clone all profiles, including those with restrictions.');
            results.add('');
            
            Integer successCount = 0;
            Integer failureCount = 0;
            Integer skippedCount = 0;
            
            for (ProfileCloneInfo profileInfo : allProfiles) {
                try {
                    String result = cloneProfileWithMetadataAPI(service, profileInfo);
                    if (result.contains('Successfully cloned') || result.contains('created successfully')) {
                        successCount++;
                        results.add('✅ ' + profileInfo.profileName + ' -> CLONE_' + profileInfo.profileName);
                    } else if (result.contains('already exists')) {
                        skippedCount++;
                        results.add('⏭️ ' + profileInfo.profileName + ' - Already exists, skipped');
                    } else {
                        failureCount++;
                        results.add('❌ ' + profileInfo.profileName + ' - ' + result);
                    }
                } catch (Exception e) {
                    failureCount++;
                    results.add('❌ ' + profileInfo.profileName + ' - Error: ' + e.getMessage());
                }
            }
            
            results.add('');
            results.add('=== SUMMARY ===');
            results.add('Successfully cloned: ' + successCount + ' profiles');
            results.add('Failed to clone: ' + failureCount + ' profiles');
            results.add('Skipped (already exist): ' + skippedCount + ' profiles');
            results.add('Total processed: ' + allProfiles.size() + ' profiles');
            
            if (successCount > 0) {
                results.add('');
                results.add('🎉 Success! Some profiles were cloned successfully.');
            }
            
            if (failureCount > 0) {
                results.add('');
                results.add('💡 Note: Some profiles failed due to license restrictions or Metadata API limitations.');
                results.add('   This is normal for specialized profile types like Partner, Community, API-only, etc.');
                results.add('   Try cloning individual profiles to see specific error messages.');
            }
            
            return String.join(results, '\n');
            
        } catch (Exception e) {
            throw new AuraHandledException('Error starting profile clone process: ' + e.getMessage());
        }
    }

    /**
     * Clone a single profile
     */
    private static String cloneSingleProfile(MetadataService.MetadataPort service, String instruction) {
        try {
            String profileName = extractProfileName(instruction);
            
            if (String.isBlank(profileName)) {
                return 'Could not determine profile name. Use format: "clone profile [ProfileName]"';
            }
            
            ProfileCloneInfo profileInfo = new ProfileCloneInfo();
            profileInfo.profileName = profileName;
            
            return cloneProfileWithMetadataAPI(service, profileInfo);
            
        } catch (Exception e) {
            throw new AuraHandledException('Error cloning profile: ' + e.getMessage());
        }
    }

    /**
     * Get all profiles for cloning
     */
    private static List<ProfileCloneInfo> getAllProfilesForCloning() {
        List<ProfileCloneInfo> allProfiles = new List<ProfileCloneInfo>();
        
        List<Profile> profiles = [SELECT Id, Name, UserLicense.Name, UserType FROM Profile ORDER BY Name];
        
        for (Profile p : profiles) {
            ProfileCloneInfo info = new ProfileCloneInfo();
            info.profileId = p.Id;
            info.profileName = p.Name;
            info.licenseName = p.UserLicense.Name;
            info.userType = p.UserType;
            allProfiles.add(info);
        }
        
        return allProfiles;
    }

    /**
     * Clone profile using Metadata API with enhanced error handling
     */
    private static String cloneProfileWithMetadataAPI(MetadataService.MetadataPort service, ProfileCloneInfo profileInfo) {
        try {
            String clonedProfileName = 'CLONE_' + profileInfo.profileName;
            
            // Check if cloned profile already exists
            List<Profile> existingProfiles = [SELECT Id FROM Profile WHERE Name = :clonedProfileName LIMIT 1];
            if (!existingProfiles.isEmpty()) {
                return 'Profile "' + clonedProfileName + '" already exists. Skipping.';
            }
            
            // Try to read the source profile
            MetadataService.ReadProfileResult readResult = (MetadataService.ReadProfileResult) 
                service.readMetadata('Profile', new String[] { profileInfo.profileName });
            
            if (readResult == null || readResult.records == null || readResult.records.isEmpty()) {
                return 'Source profile not found or not accessible via Metadata API';
            }

            MetadataService.Profile sourceProfile = readResult.records[0];
            
            // Create the cloned profile
            MetadataService.Profile clonedProfile = createProfileClone(sourceProfile, 'CLONE_');
            
            // Attempt to create the profile
            List<MetadataService.SaveResult> results = service.createMetadata(new MetadataService.Metadata[] { clonedProfile });
            
            String result = processSaveResults(results, 'profile clone');
            
            if (result.contains('Error')) {
                // Provide specific guidance based on profile type
                if (profileInfo.licenseName.contains('Partner') || profileInfo.licenseName.contains('Community') || 
                    profileInfo.licenseName.contains('Identity') || profileInfo.licenseName.contains('Force.com') ||
                    profileInfo.licenseName.contains('Chatter') || profileInfo.licenseName.contains('Analytics') ||
                    profileInfo.licenseName.contains('API Only') || profileInfo.licenseName.contains('Minimum Access')) {
                    return result + ' (License: ' + profileInfo.licenseName + ' - This profile type has restrictions)';
                } else {
                    return result + ' (License: ' + profileInfo.licenseName + ', Type: ' + profileInfo.userType + ')';
                }
            }
            
            return 'Successfully cloned profile "' + profileInfo.profileName + '" to "' + clonedProfileName + '"';
            
        } catch (Exception e) {
            return 'Error: ' + e.getMessage() + ' (License: ' + profileInfo.licenseName + ', Type: ' + profileInfo.userType + ')';
        }
    }

    /**
     * Create a profile clone with all permissions
     */
    private static MetadataService.Profile createProfileClone(MetadataService.Profile sourceProfile, String prefix) {
        MetadataService.Profile clonedProfile = new MetadataService.Profile();
        
        clonedProfile.fullName = prefix + sourceProfile.fullName;
        clonedProfile.description = 'Cloned from ' + sourceProfile.fullName + ' - ' + 
            (sourceProfile.description != null ? sourceProfile.description : '') + ' (Cloned on ' + Datetime.now().format() + ')';
        clonedProfile.userLicense = sourceProfile.userLicense;
        clonedProfile.custom = true;
        
        // Clone all permissions and settings
        clonedProfile.applicationVisibilities = sourceProfile.applicationVisibilities;
        clonedProfile.categoryGroupVisibilities = sourceProfile.categoryGroupVisibilities;
        clonedProfile.classAccesses = sourceProfile.classAccesses;
        clonedProfile.customPermissions = sourceProfile.customPermissions;
        clonedProfile.externalDataSourceAccesses = sourceProfile.externalDataSourceAccesses;
        clonedProfile.fieldPermissions = sourceProfile.fieldPermissions;
        clonedProfile.layoutAssignments = sourceProfile.layoutAssignments;
        clonedProfile.loginHours = sourceProfile.loginHours;
        clonedProfile.loginIpRanges = sourceProfile.loginIpRanges;
        clonedProfile.objectPermissions = sourceProfile.objectPermissions;
        clonedProfile.pageAccesses = sourceProfile.pageAccesses;
        clonedProfile.profileActionOverrides = sourceProfile.profileActionOverrides;
        clonedProfile.recordTypeVisibilities = sourceProfile.recordTypeVisibilities;
        
        // Filter tab visibilities to only include valid tabs
        clonedProfile.tabVisibilities = filterValidTabVisibilities(sourceProfile.tabVisibilities);
        
        clonedProfile.userPermissions = sourceProfile.userPermissions;
        
        return clonedProfile;
    }

    /**
     * Extract profile name from instruction
     */
    private static String extractProfileName(String instruction) {
        if (instruction.toLowerCase().contains('clone profile ')) {
            String afterClone = instruction.substringAfter('clone profile ').trim();
            return afterClone.split(' ')[0];
        }
        return null;
    }

    /**
     * Filter tab visibilities to only include valid tabs
     */
    private static MetadataService.ProfileTabVisibility[] filterValidTabVisibilities(MetadataService.ProfileTabVisibility[] sourceTabVisibilities) {
        if (sourceTabVisibilities == null || sourceTabVisibilities.isEmpty()) {
            return sourceTabVisibilities;
        }
        
        List<MetadataService.ProfileTabVisibility> validTabVisibilities = new List<MetadataService.ProfileTabVisibility>();
        
        // Use a conservative list of common tabs that are typically available
        Set<String> validTabNames = new Set<String>{
            'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Campaign', 'Task', 'Event',
            'Note', 'Attachment', 'Solution', 'User', 'Group', 'Queue', 'Report', 'Dashboard',
            'Setup', 'Home', 'Chatter', 'Files', 'Content', 'Ideas', 'Votes', 'Topics',
            'Knowledge', 'Articles', 'Contracts', 'Orders', 'Products', 'Price Books',
            'Assets', 'Work Orders', 'Service Contracts', 'Entitlements', 'Milestones',
            'Time', 'Expenses', 'Approvals', 'Processes', 'Flows', 'Custom Objects',
            'Analytics', 'Einstein', 'EinsteinAnalytics', 'EinsteinAnalyticsPlus',
            'EinsteinAnalyticsPlusInsights', 'EinsteinAnalyticsPlusInsightsPlus',
            'EinsteinAnalyticsPlusInsightsPlusPlus', 'EinsteinAnalyticsPlusInsightsPlusPlusPlus',
            'EinsteinAnalyticsPlusInsightsPlusPlusPlusPlus', 'EinsteinAnalyticsPlusInsightsPlusPlusPlusPlusPlus'
        };
        
        // Filter source tab visibilities
        for (MetadataService.ProfileTabVisibility tabVis : sourceTabVisibilities) {
            if (tabVis != null && tabVis.tab != null && validTabNames.contains(tabVis.tab)) {
                validTabVisibilities.add(tabVis);
            } else {
                System.debug('Filtering out invalid tab: ' + (tabVis != null ? tabVis.tab : 'null'));
            }
        }
        
        System.debug('Filtered tab visibilities: ' + validTabVisibilities.size() + ' valid out of ' + sourceTabVisibilities.size() + ' total');
        return validTabVisibilities;
    }

    /**
     * Wrapper class for profile clone information
     */
    private class ProfileCloneInfo {
        public Id profileId;
        public String profileName;
        public String licenseName;
        public String userType;
        public String cloneability;
    }

    @AuraEnabled
    public static String debugProfileCloningIssue(String profileName) {
        try {
            System.debug('Debugging profile cloning issue for: ' + profileName);
            
            // Check if profile exists
            List<Profile> profiles = [SELECT Id, Name, UserLicense.Name, UserType, Description 
                                     FROM Profile WHERE Name = :profileName LIMIT 1];
            
            if (profiles.isEmpty()) {
                return '❌ Profile "' + profileName + '" not found in the org.';
            }
            
            Profile p = profiles[0];
            String result = '=== PROFILE ANALYSIS ===\n';
            result += 'Profile Name: ' + p.Name + '\n';
            result += 'License: ' + p.UserLicense.Name + '\n';
            result += 'User Type: ' + p.UserType + '\n';
            result += 'Description: ' + (p.Description != null ? p.Description : 'No description') + '\n\n';
            
            // Check cloneability
            String cloneability = checkProfileCloneability(p.Name);
            result += 'Cloneability Status: ' + cloneability + '\n\n';
            
            // Check if this is a custom profile (not a standard Salesforce profile)
            Boolean isCustomProfile = !p.UserLicense.Name.equals('Salesforce') && 
                                    !p.UserLicense.Name.equals('Salesforce Platform') && 
                                    !p.UserLicense.Name.equals('Force.com - App Subscription');
            
            // Special handling for all custom profiles
            if (isCustomProfile) {
                String profileType = 'custom profile';
                if (p.UserLicense.Name.contains('High Volume Customer Portal')) profileType = 'High Volume Customer Portal profile';
                else if (p.UserLicense.Name.contains('Partner')) profileType = 'Partner profile';
                else if (p.UserLicense.Name.contains('Community')) profileType = 'Community profile';
                else if (p.UserLicense.Name.contains('API Only')) profileType = 'API Only profile';
                else if (p.UserLicense.Name.contains('Minimum Access')) profileType = 'Minimum Access profile';
                else if (p.UserLicense.Name.contains('Identity')) profileType = 'Identity profile';
                else if (p.UserLicense.Name.contains('Force.com')) profileType = 'Force.com profile';
                else if (p.UserLicense.Name.contains('Chatter')) profileType = 'Chatter profile';
                else if (p.UserLicense.Name.contains('Analytics')) profileType = 'Analytics profile';
                else if (p.UserLicense.Name.contains('Einstein')) profileType = 'Einstein profile';
                else if (p.UserLicense.Name.contains('B2B')) profileType = 'B2B profile';
                else if (p.UserLicense.Name.contains('Cross Org')) profileType = 'Cross Org profile';
                
                result += '⚠️ ISSUE IDENTIFIED: This is a ' + profileType + '\n';
                result += profileType + 's have special restrictions:\n';
                result += '1. They require specific licenses (' + p.UserLicense.Name + ')\n';
                result += '2. They may have limited Metadata API access\n';
                result += '3. They often require special permissions to clone\n';
                result += '4. They may be tied to specific user types (' + p.UserType + ')\n\n';
                
                result += '💡 SOLUTIONS:\n';
                result += '1. Use a standard profile as source instead:\n';
                result += '   - "Create a profile called SalesProfilecloned by cloning Standard User"\n';
                result += '   - "Create a profile called SalesProfilecloned by cloning System Administrator"\n';
                result += '   - "Create a profile called SalesProfilecloned by cloning Marketing User"\n\n';
                
                result += '2. If you need similar permissions, manually create the profile in Setup\n';
                result += '3. Check if you have "Manage Profiles and Permission Sets" permission\n\n';
                
                result += '🔍 RECOMMENDED ACTION:\n';
                result += 'Try this command instead:\n';
                result += 'Create a profile called SalesProfilecloned by cloning Standard User\n';
                
            } else if (cloneability.contains('NOT_CLONEABLE')) {
                result += '❌ This profile cannot be cloned due to license restrictions.\n';
                result += '💡 Try using a standard profile as source instead.\n';
            } else if (cloneability.contains('CLONEABLE_WITH_RESTRICTIONS')) {
                result += '⚠️ This profile can be cloned but may have restrictions.\n';
                result += '💡 Try using a fully cloneable profile as source instead.\n';
            } else {
                result += '✅ This profile should be cloneable.\n';
                result += 'If cloning still fails, check your permissions and try again.\n';
            }
            
            // Show available cloneable profiles
            result += '\n=== AVAILABLE CLONEABLE PROFILES ===\n';
            List<Profile> cloneableProfiles = [SELECT Name, UserLicense.Name 
                                              FROM Profile 
                                              WHERE UserLicense.Name IN ('Salesforce', 'Salesforce Platform', 'Force.com - App Subscription')
                                              ORDER BY Name 
                                              LIMIT 10];
            
            for (Profile cp : cloneableProfiles) {
                result += '✅ ' + cp.Name + ' (License: ' + cp.UserLicense.Name + ')\n';
            }
            
            return result;
            
        } catch (Exception e) {
            return 'Error debugging profile: ' + e.getMessage() + '\nStack: ' + e.getStackTraceString();
        }
    }

    @AuraEnabled
    public static String listCustomProfiles() {
        try {
            List<Profile> allProfiles = [SELECT Id, Name, UserLicense.Name, UserType, Description 
                                        FROM Profile 
                                        ORDER BY Name 
                                        LIMIT 200];
            
            List<String> customProfiles = new List<String>();
            List<String> standardProfiles = new List<String>();
            
            for (Profile p : allProfiles) {
                // Check if this is a custom profile (not a standard Salesforce profile)
                Boolean isCustomProfile = !p.UserLicense.Name.equals('Salesforce') && 
                                        !p.UserLicense.Name.equals('Salesforce Platform') && 
                                        !p.UserLicense.Name.equals('Force.com - App Subscription');
                
                String profileInfo = p.Name + ' (License: ' + p.UserLicense.Name + ', Type: ' + p.UserType + ')';
                if (p.Description != null) {
                    profileInfo += ' - ' + p.Description;
                }
                
                if (isCustomProfile) {
                    String cloneability = checkProfileCloneability(p.Name);
                    if (cloneability.contains('NOT_CLONEABLE')) {
                        customProfiles.add('❌ ' + profileInfo + ' - NOT CLONEABLE');
                    } else if (cloneability.contains('CLONEABLE_WITH_RESTRICTIONS')) {
                        customProfiles.add('⚠️ ' + profileInfo + ' - CLONEABLE WITH RESTRICTIONS');
                    } else {
                        customProfiles.add('✅ ' + profileInfo + ' - CLONEABLE');
                    }
                } else {
                    standardProfiles.add('✅ ' + profileInfo + ' - STANDARD PROFILE');
                }
            }
            
            List<String> result = new List<String>();
            result.add('=== CUSTOM PROFILES IN YOUR ORG ===');
            result.add('These profiles may have cloning restrictions:');
            result.add('=============================================');
            
            if (!customProfiles.isEmpty()) {
                for (String profile : customProfiles) {
                    result.add(profile);
                }
            } else {
                result.add('No custom profiles found.');
            }
            
            result.add('');
            result.add('=== STANDARD PROFILES (RECOMMENDED FOR CLONING) ===');
            result.add('These profiles are safe to use as source for cloning:');
            result.add('=====================================================');
            
            if (!standardProfiles.isEmpty()) {
                for (String profile : standardProfiles) {
                    result.add(profile);
                }
            } else {
                result.add('No standard profiles found.');
            }
            
            result.add('');
            result.add('=== SUMMARY ===');
            result.add('Custom profiles: ' + customProfiles.size());
            result.add('Standard profiles: ' + standardProfiles.size());
            result.add('Total profiles: ' + allProfiles.size());
            result.add('');
            result.add('💡 RECOMMENDATION: Use standard profiles (✅) for cloning to avoid restrictions.');
            result.add('   Custom profiles (❌/⚠️) often have license or API restrictions.');
            
            return String.join(result, '\n');
            
        } catch (Exception e) {
            return 'Error listing custom profiles: ' + e.getMessage();
        }
    }

    @AuraEnabled
    public static String testProfileCloning(String sourceProfileName, String newProfileName) {
        try {
            System.debug('Testing profile cloning: ' + sourceProfileName + ' -> ' + newProfileName);
            
            // Check if source profile exists
            List<Profile> sourceProfiles = [SELECT Id, Name, UserLicense.Name, UserType, Description 
                                           FROM Profile WHERE Name = :sourceProfileName LIMIT 1];
            
            if (sourceProfiles.isEmpty()) {
                return '❌ Source profile "' + sourceProfileName + '" not found in the org.';
            }
            
            Profile sourceProfile = sourceProfiles[0];
            
            // Check if new profile already exists
            List<Profile> existingProfiles = [SELECT Id FROM Profile WHERE Name = :newProfileName LIMIT 1];
            if (!existingProfiles.isEmpty()) {
                return '❌ Profile "' + newProfileName + '" already exists. Please choose a different name.';
            }
            
            String result = '=== PROFILE CLONING TEST ===\n';
            result += 'Source Profile: ' + sourceProfile.Name + '\n';
            result += 'License: ' + sourceProfile.UserLicense.Name + '\n';
            result += 'User Type: ' + sourceProfile.UserType + '\n';
            result += 'Description: ' + (sourceProfile.Description != null ? sourceProfile.Description : 'No description') + '\n\n';
            
            // Check cloneability
            String cloneability = checkProfileCloneability(sourceProfile.Name);
            result += 'Cloneability Status: ' + cloneability + '\n\n';
            
            // Check if this is a custom profile
            Boolean isCustomProfile = !sourceProfile.UserLicense.Name.equals('Salesforce') && 
                                    !sourceProfile.UserLicense.Name.equals('Salesforce Platform') && 
                                    !sourceProfile.UserLicense.Name.equals('Force.com - App Subscription');
            
            if (isCustomProfile) {
                result += '⚠️ This is a custom profile with license: ' + sourceProfile.UserLicense.Name + '\n';
                result += 'Custom profiles may have restrictions, but we will attempt to clone.\n\n';
            } else {
                result += '✅ This is a standard profile - should be fully cloneable.\n\n';
            }
            
            // Test the actual cloning process
            result += '=== ATTEMPTING CLONE ===\n';
            
            try {
                // Get API credentials
                MetadataAPI__c settings = MetadataAPI__c.getInstance(UserInfo.getUserId());
                if (settings == null || String.isBlank(settings.Username__c) || String.isBlank(settings.Password__c)) {
                    return result + '❌ API credentials not configured. Please set up your API credentials first.';
                }
                
                String sessionId = getSessionId(settings.Username__c, settings.Password__c);
                if (String.isBlank(sessionId)) {
                    return result + '❌ Failed to get session ID. Please check your API credentials.';
                }
                
                MetadataService.MetadataPort service = createService(sessionId);
                
                // Try to read the source profile
                MetadataService.ReadProfileResult readResult = (MetadataService.ReadProfileResult) 
                    service.readMetadata('Profile', new String[] { sourceProfile.Name });
                
                if (readResult == null || readResult.records == null || readResult.records.isEmpty()) {
                    return result + '❌ Failed to read source profile via Metadata API. This profile may not be accessible.';
                }
                
                result += '✅ Successfully read source profile via Metadata API.\n';
                
                // Try to create the new profile
                MetadataService.Profile newProfile = new MetadataService.Profile();
                newProfile.fullName = newProfileName;
                newProfile.description = 'Test clone from ' + sourceProfile.Name;
                
                // Copy basic settings
                MetadataService.Profile sourceProfileMeta = readResult.records[0];
                newProfile.userLicense = sourceProfileMeta.userLicense;
                newProfile.applicationVisibilities = sourceProfileMeta.applicationVisibilities;
                newProfile.classAccesses = sourceProfileMeta.classAccesses;
                newProfile.customPermissions = sourceProfileMeta.customPermissions;
                newProfile.fieldPermissions = sourceProfileMeta.fieldPermissions;
                newProfile.objectPermissions = sourceProfileMeta.objectPermissions;
                newProfile.userPermissions = sourceProfileMeta.userPermissions;
                
                List<MetadataService.SaveResult> results = service.createMetadata(new MetadataService.Metadata[] { newProfile });
                
                String saveResult = processSaveResults(results, 'test profile');
                
                if (saveResult.contains('Error')) {
                    result += '❌ Profile creation failed: ' + saveResult + '\n\n';
                    result += '💡 TROUBLESHOOTING:\n';
                    result += '1. Check if you have "Manage Profiles and Permission Sets" permission\n';
                    result += '2. Try using a standard profile as source instead\n';
                    result += '3. Some custom profiles have Metadata API restrictions\n';
                    result += '4. Check the specific error message above for details\n';
                } else {
                    result += '✅ Profile created successfully: ' + saveResult + '\n\n';
                    result += '🎉 SUCCESS! The profile was cloned successfully.\n';
                    result += 'You can now use this profile as a source for future cloning.\n';
                }
                
            } catch (Exception e) {
                result += '❌ Exception during cloning: ' + e.getMessage() + '\n';
                result += 'Stack trace: ' + e.getStackTraceString() + '\n\n';
                result += '💡 This may indicate:\n';
                result += '1. API permission issues\n';
                result += '2. Profile-specific restrictions\n';
                result += '3. Metadata API limitations\n';
            }
            
            return result;
            
        } catch (Exception e) {
            return 'Error testing profile cloning: ' + e.getMessage() + '\nStack: ' + e.getStackTraceString();
        }
    }

    /**
     * Handle user creation requests
     */
    private static String handleCreateUser(MetadataService.MetadataPort service, String instruction) {
        Map<String, String> userDetails = parseUserDetails(instruction);
        
        String firstName = userDetails.get('firstName');
        String lastName = userDetails.get('lastName');
        String username = userDetails.get('username');
        String email = userDetails.get('email');
        String alias = userDetails.get('alias');
        String nickname = userDetails.get('nickname');
        String licenseName = userDetails.get('licenseName');
        String profileName = userDetails.get('profileName');
        String roleName = userDetails.get('roleName');
        Boolean isActive = userDetails.containsKey('isActive') ? Boolean.valueOf(userDetails.get('isActive')) : true;

        // Validate required fields
        if (String.isBlank(firstName) || String.isBlank(lastName) || String.isBlank(username) || String.isBlank(email)) {
            return 'Error: Missing required fields. Please provide first name, last name, username, and email.';
        }

        try {
            // Check if user already exists
            List<User> existingUsers = [SELECT Id FROM User WHERE Username = :username LIMIT 1];
            if (!existingUsers.isEmpty()) {
                return 'Error: User with username "' + username + '" already exists.';
            }

            // Get Profile ID
            Id profileId = null;
            if (String.isNotBlank(profileName)) {
                List<Profile> profiles = [SELECT Id FROM Profile WHERE Name = :profileName LIMIT 1];
                if (profiles.isEmpty()) {
                    return 'Error: Profile "' + profileName + '" not found. ' + suggestSimilarProfiles(profileName);
                }
                profileId = profiles[0].Id;
            } else {
                // Default to Standard User profile if not specified
                List<Profile> defaultProfiles = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
                if (!defaultProfiles.isEmpty()) {
                    profileId = defaultProfiles[0].Id;
                }
            }

            // Get Role ID
            Id roleId = null;
            if (String.isNotBlank(roleName)) {
                List<UserRole> roles = [SELECT Id FROM UserRole WHERE Name = :roleName LIMIT 1];
                if (roles.isEmpty()) {
                    return 'Error: Role "' + roleName + '" not found. Available roles: ' + getAvailableRoles();
                }
                roleId = roles[0].Id;
            }

            // Create the user
            User newUser = new User();
            newUser.FirstName = firstName;
            newUser.LastName = lastName;
            newUser.Username = username;
            newUser.Email = email;
            newUser.Alias = String.isNotBlank(alias) ? alias : (firstName.substring(0, 1) + lastName.substring(0, 4)).toLowerCase();
            newUser.ProfileId = profileId;
            newUser.UserRoleId = roleId;
            newUser.IsActive = isActive;
            newUser.EmailEncodingKey = 'UTF-8';
            newUser.LanguageLocaleKey = 'en_US';
            newUser.LocaleSidKey = 'en_US';
            newUser.TimeZoneSidKey = 'America/New_York';

            insert newUser;

            String result = '✅ User created successfully!\n';
            result += 'Name: ' + firstName + ' ' + lastName + '\n';
            result += 'Username: ' + username + '\n';
            result += 'Email: ' + email + '\n';
            result += 'Alias: ' + newUser.Alias + '\n';
            if (String.isNotBlank(nickname)) {
                result += 'Nickname (parsed but not stored): ' + nickname + '\n';
            }
            result += 'Profile: ' + profileName + '\n';
            if (String.isNotBlank(roleName)) {
                result += 'Role: ' + roleName + '\n';
            }
            result += 'Status: ' + (isActive ? 'Active' : 'Inactive') + '\n';
            result += '\n💡 Note: The user will receive a welcome email with login instructions.';

            return result;

        } catch (Exception e) {
            return 'Error creating user: ' + e.getMessage() + '\n\nTroubleshooting tips:\n' +
                   '1. Ensure you have "Manage Users" permission\n' +
                   '2. Check that the username is unique across all Salesforce orgs\n' +
                   '3. Verify the email format is valid\n' +
                   '4. Ensure the profile and license are compatible\n' +
                   '5. Check that the role exists and is accessible';
        }
    }

    /**
     * Parse user details from natural language instruction
     */
    private static Map<String, String> parseUserDetails(String instruction) {
        Map<String, String> details = new Map<String, String>();
        
        // Normalize the instruction - replace newlines with spaces and clean up
        String normalized = instruction.replace('\n', ' ').replace('\r', ' ').replaceAll(' +', ' ').trim();
        String cleanInstruction = normalized.toLowerCase();
        
        System.debug('Original instruction: ' + instruction);
        System.debug('Normalized instruction: ' + normalized);
        System.debug('Clean instruction: ' + cleanInstruction);

        // Parse first name and last name using regex
        Pattern namePattern = Pattern.compile('first name ([a-zA-Z]+) and last name ([a-zA-Z]+)');
        Matcher nameMatcher = namePattern.matcher(cleanInstruction);
        if (nameMatcher.find()) {
            String firstName = nameMatcher.group(1);
            String lastName = nameMatcher.group(2);
            details.put('firstName', firstName);
            details.put('lastName', lastName);
            System.debug('Parsed firstName: ' + firstName + ', lastName: ' + lastName);
        }

        // Parse username using regex
        Pattern usernamePattern = Pattern.compile('username as ([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})');
        Matcher usernameMatcher = usernamePattern.matcher(cleanInstruction);
        if (usernameMatcher.find()) {
            String username = usernameMatcher.group(1);
            details.put('username', username);
            System.debug('Parsed username: ' + username);
        }

        // Parse email using regex
        Pattern emailPattern = Pattern.compile('email as ([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})');
        Matcher emailMatcher = emailPattern.matcher(cleanInstruction);
        if (emailMatcher.find()) {
            String email = emailMatcher.group(1);
            details.put('email', email);
            System.debug('Parsed email: ' + email);
        }

        // Parse alias using regex
        Pattern aliasPattern = Pattern.compile('alias as ([a-zA-Z0-9]+)');
        Matcher aliasMatcher = aliasPattern.matcher(cleanInstruction);
        if (aliasMatcher.find()) {
            String alias = aliasMatcher.group(1);
            details.put('alias', alias);
            System.debug('Parsed alias: ' + alias);
        }

        // Parse nickname using regex
        Pattern nicknamePattern = Pattern.compile('nickname as ([a-zA-Z0-9.]+)');
        Matcher nicknameMatcher = nicknamePattern.matcher(cleanInstruction);
        if (nicknameMatcher.find()) {
            String nickname = nicknameMatcher.group(1);
            details.put('nickname', nickname);
            System.debug('Parsed nickname: ' + nickname);
        }

        // Parse license using regex
        Pattern licensePattern = Pattern.compile('use the ([a-zA-Z ]+) license');
        Matcher licenseMatcher = licensePattern.matcher(cleanInstruction);
        if (licenseMatcher.find()) {
            String license = licenseMatcher.group(1).trim();
            details.put('licenseName', license);
            System.debug('Parsed license: ' + license);
        }

        // Parse profile using improved regex (non-greedy, stops at 'and the role', period, comma, or end)
        Pattern profilePattern = Pattern.compile('assign the profile ([a-zA-Z0-9 _-]+?)(?: and the role|\\.|,|$)');
        Matcher profileMatcher = profilePattern.matcher(cleanInstruction);
        if (profileMatcher.find()) {
            String profile = profileMatcher.group(1).trim();
            details.put('profileName', profile);
            System.debug('Parsed profile: ' + profile);
        }

        // Parse role using improved regex (non-greedy, stops at period, comma, or end)
        Pattern rolePattern = Pattern.compile('and the role ([a-zA-Z0-9 _-]+?)(?:\\.|,|$)');
        Matcher roleMatcher = rolePattern.matcher(cleanInstruction);
        if (roleMatcher.find()) {
            String role = roleMatcher.group(1).trim();
            details.put('roleName', role);
            System.debug('Parsed role: ' + role);
        }

        // Parse active status
        if (cleanInstruction.contains('mark the user as active')) {
            details.put('isActive', 'true');
            System.debug('Parsed isActive: true');
        } else if (cleanInstruction.contains('mark the user as inactive')) {
            details.put('isActive', 'false');
            System.debug('Parsed isActive: false');
        }

        // Fallback: use email as username if username is missing
        if (String.isBlank(details.get('username')) && String.isNotBlank(details.get('email'))) {
            details.put('username', details.get('email'));
            System.debug('Using email as username: ' + details.get('email'));
        }

        // Debug logging to see what was parsed
        System.debug('Final parsed user details: ' + details);

        return details;
    }

    /**
     * Get available user licenses
     */
    private static String getAvailableLicenses() {
        try {
            List<UserLicense> licenses = [SELECT Name FROM UserLicense ORDER BY Name LIMIT 20];
            List<String> licenseNames = new List<String>();
            for (UserLicense license : licenses) {
                licenseNames.add(license.Name);
            }
            return String.join(licenseNames, ', ');
        } catch (Exception e) {
            return 'Error retrieving licenses: ' + e.getMessage();
        }
    }

    /**
     * Get available profiles
     */
    private static String getAvailableProfiles() {
        try {
            List<Profile> profiles = [SELECT Name FROM Profile ORDER BY Name LIMIT 20];
            List<String> profileNames = new List<String>();
            for (Profile profile : profiles) {
                profileNames.add(profile.Name);
            }
            return String.join(profileNames, ', ');
        } catch (Exception e) {
            return 'Error retrieving profiles: ' + e.getMessage();
        }
    }

    /**
     * Get available roles
     */
    private static String getAvailableRoles() {
        try {
            List<UserRole> roles = [SELECT Name FROM UserRole ORDER BY Name LIMIT 20];
            List<String> roleNames = new List<String>();
            for (UserRole role : roles) {
                roleNames.add(role.Name);
            }
            return String.join(roleNames, ', ');
        } catch (Exception e) {
            return 'Error retrieving roles: ' + e.getMessage();
        }
    }

    /**
     * Debug method to test user parsing
     */
    @AuraEnabled
    public static String debugUserParsing(String instruction) {
        try {
            Map<String, String> parsedDetails = parseUserDetails(instruction);
            
            String result = '=== USER PARSING DEBUG ===\n';
            result += 'Original Instruction: ' + instruction + '\n\n';
            result += 'Parsed Details:\n';
            result += '================\n';
            
            for (String key : parsedDetails.keySet()) {
                result += key + ': ' + parsedDetails.get(key) + '\n';
            }
            
            result += '\nValidation:\n';
            result += '===========\n';
            result += 'firstName: ' + (String.isNotBlank(parsedDetails.get('firstName')) ? '✅ Found' : '❌ Missing') + '\n';
            result += 'lastName: ' + (String.isNotBlank(parsedDetails.get('lastName')) ? '✅ Found' : '❌ Missing') + '\n';
            result += 'username: ' + (String.isNotBlank(parsedDetails.get('username')) ? '✅ Found' : '❌ Missing') + '\n';
            result += 'email: ' + (String.isNotBlank(parsedDetails.get('email')) ? '✅ Found' : '❌ Missing') + '\n';
            result += 'alias: ' + (String.isNotBlank(parsedDetails.get('alias')) ? '✅ Found' : '❌ Missing') + '\n';
            result += 'nickname: ' + (String.isNotBlank(parsedDetails.get('nickname')) ? '✅ Found' : '❌ Missing') + '\n';
            result += 'profileName: ' + (String.isNotBlank(parsedDetails.get('profileName')) ? '✅ Found' : '❌ Missing') + '\n';
            result += 'roleName: ' + (String.isNotBlank(parsedDetails.get('roleName')) ? '✅ Found' : '❌ Missing') + '\n';
            result += 'isActive: ' + (String.isNotBlank(parsedDetails.get('isActive')) ? '✅ Found' : '❌ Missing') + '\n';
            
            return result;
            
        } catch (Exception e) {
            return 'Error in debug parsing: ' + e.getMessage() + '\nStack: ' + e.getStackTraceString();
        }
    }

    /**
     * Suggest similar profile names when exact match not found
     */
    private static String suggestSimilarProfiles(String searchName) {
        try {
            List<Profile> profiles = [SELECT Name FROM Profile ORDER BY Name LIMIT 50];
            List<String> suggestions = new List<String>();
            
            for (Profile profile : profiles) {
                if (profile.Name.toLowerCase().contains(searchName.toLowerCase()) || 
                    searchName.toLowerCase().contains(profile.Name.toLowerCase())) {
                    suggestions.add(profile.Name);
                }
            }
            
            if (!suggestions.isEmpty()) {
                return 'Did you mean: ' + String.join(suggestions, ', ');
            } else {
                return 'No similar profiles found. Available profiles: ' + getAvailableProfiles();
            }
        } catch (Exception e) {
            return 'Error suggesting profiles: ' + e.getMessage();
        }
    }

    /**
     * Test method for the specific user creation issue
     */
    @AuraEnabled
    public static String testUserCreation() {
        try {
            String testInstruction = 'Create a user with first name Rahul and last name Sharma. Set username as rahul.sharma@example.com, email as rahul.sharma@example.com, alias as rshar, and nickname as rahul.s. Assign the profile Standard User and the role CEO. Mark the user as active.';
            
            String debugResult = debugUserParsing(testInstruction);
            
            String result = '=== TESTING USER CREATION ===\n';
            result += debugResult;
            result += '\n\n=== TRYING ACTUAL CREATION ===\n';
            
            // Try to actually create the user
            try {
                String creationResult = handleCreateUser(null, testInstruction);
                result += 'Creation Result: ' + creationResult;
            } catch (Exception e) {
                result += 'Creation Error: ' + e.getMessage();
            }
            
            return result;
            
        } catch (Exception e) {
            return 'Error in test: ' + e.getMessage() + '\nStack: ' + e.getStackTraceString();
        }
    }

}