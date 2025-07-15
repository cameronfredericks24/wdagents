public with sharing class ApprovalProcessProxy {
  @AuraEnabled
  public static String callNodeApi(String prompt, String apiKey) {
    HttpRequest req = new HttpRequest();
    req.setEndpoint('https://cced-2405-201-d022-3150-c5b6-e78c-a46e-7d61.ngrok-free.app/api/generate-metadata');
    req.setMethod('POST');
    req.setHeader('Content-Type', 'application/json');
    req.setTimeout(30000);
    
    // Proper JSON escaping for Apex
    String safePrompt = prompt
      .replace('\\', '\\\\')
      .replace('\r', '\\r')
      .replace('\n', '\\n')
      .replace('"', '\\"');
    
    String body = '{' +
      '\"prompt\":\"' + safePrompt + '\",' +
      '\"apiKey\":\"' + apiKey + '\"' +
      '}';
    req.setBody(body);
    
    Http http = new Http();
    try {
      HttpResponse res = http.send(req);
      System.debug('Response Status: ' + res.getStatusCode());
      System.debug('Response Body: ' + res.getBody());
      
      if (res.getStatusCode() == 401) {
        return '{\"error\":\"Authentication failed\",\"details\":\"Invalid API key. Please check your configuration.\"}';
      } else if (res.getStatusCode() >= 200 && res.getStatusCode() < 300) {
        return res.getBody();
      } else {
        return '{\"error\":\"Server error\",\"details\":\"HTTP ' + res.getStatusCode() + ' - ' + res.getStatus() + '\"}';
      }
    } catch (Exception e) {
      System.debug('Callout Exception: ' + e.getMessage());
      return '{\"error\":\"Connection failed\",\"details\":\"' + e.getMessage().replace('"', '\\"') + '\"}';
    }
  }
}
