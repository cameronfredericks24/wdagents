public with sharing class MetadataAiAssistantController {
    /**
     * LWC Backend Controller for AI Metadata Assistant
     * Calls external AI/metadata service for generation and deployment
     */

    @AuraEnabled(cacheable=true)
    public static String getBaseUrl() {
        try {
            return Label.AI_Service_Base_URL;
        } catch (Exception e) {
            // Fallback or error handling if Label doesn't exist
            // In a real-world scenario, you'd want to handle this more gracefully
            // For now, returning an empty string and we can handle it in the LWC
            System.debug('Error fetching Custom Label AI_Service_Base_URL: ' + e.getMessage());
            throw new AuraHandledException('Custom Label "AI_Service_Base_URL" not found. Please create it in Salesforce Setup and set it to your service URL (e.g., https://your-ngrok-url.ngrok-free.app).');
        }
    }

    /**
     * Generates Salesforce metadata preview from user prompt
     * @param prompt User's natural language prompt
     * @return Metadata preview (string)
     */
    @AuraEnabled(cacheable=true)
    public static String generateMetadata(String prompt) {
        try {
            HttpRequest req = new HttpRequest();
            req.setTimeout(120000);
            req.setEndpoint(getBaseUrl() + '/api/metadata/generate');
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/json');
            req.setBody(JSON.serialize(new Map<String, Object>{'prompt' => prompt}));

            Http http = new Http();
            HttpResponse res = http.send(req);
            if (res.getStatusCode() == 200) {
                Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                return (String) result.get('metadataPreview');
            } else {
                String errorMessage = res.getBody();
                System.debug('Error from AI service: ' + res.getStatus() + ' - ' + errorMessage);
                throw new AuraHandledException('Error from AI service: ' + res.getStatus() + ' - ' + errorMessage);
            }
        } catch (Exception e) {
            System.debug('Caught exception in generateMetadata: ' + e.getTypeName() + ' - ' + e.getMessage());
            System.debug('Stack trace: ' + e.getStackTraceString());
            throw new AuraHandledException('Failed to generate metadata: ' + e.getMessage());
        }
    }

    /**
     * Deploys generated metadata to Salesforce org
     * @param metadata Metadata string (XML/JSON)
     * @return Deployment job info (jobId, etc.)
     */
    @AuraEnabled
    public static Map<String, Object> deployMetadata(String metadata) {
        try {
            HttpRequest req = new HttpRequest();
            req.setTimeout(120000);
            req.setEndpoint(getBaseUrl() + '/api/metadata/deploy');
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/json');
            req.setBody(JSON.serialize(new Map<String, Object>{'metadata' => metadata}));

            Http http = new Http();
            HttpResponse res = http.send(req);
            if (res.getStatusCode() == 200) {
                // Return the full JSON response (should include jobId)
                return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            } else {
                String errorMessage = res.getBody();
                System.debug('Error from deploy service: ' + res.getStatus() + ' - ' + errorMessage);
                throw new AuraHandledException('Error from deploy service: ' + res.getStatus() + ' - ' + errorMessage);
            }
        } catch (Exception e) {
            System.debug('Caught exception in deployMetadata: ' + e.getTypeName() + ' - ' + e.getMessage());
            System.debug('Stack trace: ' + e.getStackTraceString());
            throw new AuraHandledException('Failed to deploy metadata: ' + e.getMessage());
        }
    }

    /**
     * Poll deployment status by jobId
     */
    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getDeployStatus(String jobId) {
        try {
            HttpRequest req = new HttpRequest();
            req.setTimeout(120000);
            req.setEndpoint(getBaseUrl() + '/deploy/status/' + jobId);
            req.setMethod('GET');
            req.setHeader('Content-Type', 'application/json');

            Http http = new Http();
            HttpResponse res = http.send(req);
            if (res.getStatusCode() == 200) {
                return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            } else {
                String errorMessage = res.getBody();
                System.debug('Error from deploy status service: ' + res.getStatus() + ' - ' + errorMessage);
                throw new AuraHandledException('Error from deploy status service: ' + res.getStatus() + ' - ' + errorMessage);
            }
        } catch (Exception e) {
            System.debug('Caught exception in getDeployStatus: ' + e.getTypeName() + ' - ' + e.getMessage());
            System.debug('Stack trace: ' + e.getStackTraceString());
            throw new AuraHandledException('Failed to get deploy status: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static String checkDeploymentStatus(String jobId) {
        try {
            Http http = new Http();
            HttpRequest req = new HttpRequest();
            req.setTimeout(120000);
            req.setEndpoint(getBaseUrl() + '/api/metadata/deploy/status/' + jobId);
            req.setMethod('GET');
            req.setHeader('Content-Type', 'application/json');
            HttpResponse res = http.send(req);
            if (res.getStatusCode() == 200) {
                return res.getBody();
            } else {
                String errorMessage = res.getBody();
                System.debug('Failed to check deployment status: ' + res.getStatus() + ' - ' + errorMessage);
                throw new AuraHandledException('Failed to check deployment status: ' + res.getStatus() + ' - ' + errorMessage);
            }
        } catch (Exception e) {
            System.debug('Caught exception in checkDeploymentStatus: ' + e.getTypeName() + ' - ' + e.getMessage());
            System.debug('Stack trace: ' + e.getStackTraceString());
            throw new AuraHandledException('Failed to check deployment status: ' + e.getMessage());
        }
    }
} 