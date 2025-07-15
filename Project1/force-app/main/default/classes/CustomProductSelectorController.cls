public with sharing class CustomProductSelectorController {

    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getSuggestedProducts(Id opportunityId) {
        List<Suggested_Product_Metadata__mdt> suggestions = [
            SELECT Product_Name__c, Product_Code__c, Product_Id__c,
                   Varaint__c, Unit_List_Price__c, Tax__c,
                   Product_Validity__c, Active__c
            FROM Suggested_Product_Metadata__mdt
            WHERE Active__c = true
        ];

        List<Map<String, Object>> result = new List<Map<String, Object>>();

        for (Suggested_Product_Metadata__mdt s : suggestions) {
            Map<String, Object> product = new Map<String, Object>();
            product.put('ProductName', s.Product_Name__c);
            product.put('ProductCode', s.Product_Code__c);
            
            if (s.Product_Id__c != null) {
                product.put('Product2Id', s.Product_Id__c);
            }

            product.put('Variant', s.Varaint__c);
            product.put('Price', s.Unit_List_Price__c);
            product.put('ListPrice', s.Unit_List_Price__c); // ✅ Added line to include List Price
            product.put('Tax', s.Tax__c);
            product.put('Validity', s.Product_Validity__c);
            result.add(product);
        }

        return result;
    }

    @AuraEnabled
    public static void saveOpportunityLineItems(List<Map<String, Object>> products, Id opportunityId) {
        if (products == null || products.isEmpty()) {
            throw new AuraHandledException('No products selected.');
        }

        // Fetch Opportunity with Pricebook
        Opportunity opp = [
            SELECT Id, Pricebook2Id
            FROM Opportunity
            WHERE Id = :opportunityId
            LIMIT 1
        ];

        if (opp.Pricebook2Id == null) {
            List<Pricebook2> standardBooks = [SELECT Id FROM Pricebook2 WHERE IsStandard = true AND IsActive = true LIMIT 1];
            
            if (standardBooks.isEmpty()) {
                throw new AuraHandledException('No active Standard Pricebook found. Please activate one.');
            }
        
            opp.Pricebook2Id = standardBooks[0].Id;
            update opp;
        }
        
        

        // Extract Product2Ids
        Set<Id> product2Ids = new Set<Id>();
        for (Map<String, Object> prod : products) {
            if (prod.containsKey('Product2Id') && prod.get('Product2Id') != null) {
                product2Ids.add((Id)prod.get('Product2Id'));
            }
        }

        // Get PricebookEntry for these products
        Map<Id, Id> productToPbeMap = new Map<Id, Id>();
        for (PricebookEntry pbe : [
            SELECT Id, Product2Id
            FROM PricebookEntry
            WHERE Product2Id IN :product2Ids
              AND Pricebook2Id = :opp.Pricebook2Id
              AND IsActive = true
        ]) {
            productToPbeMap.put(pbe.Product2Id, pbe.Id);
        }

        List<OpportunityLineItem> oliList = new List<OpportunityLineItem>();
        Map<String, Id> productNameToOLIId = new Map<String, Id>();

        for (Map<String, Object> prod : products) {
            Id prod2Id = (Id)prod.get('Product2Id');
            String productName = String.valueOf(prod.get('ProductName'));

            if (prod2Id == null || !productToPbeMap.containsKey(prod2Id)) {
                throw new AuraHandledException('Missing active Pricebook Entry for product: ' + productName);
            }

            OpportunityLineItem oli = new OpportunityLineItem();
            oli.OpportunityId = opportunityId;
            oli.PricebookEntryId = productToPbeMap.get(prod2Id);
            oli.UnitPrice = Decimal.valueOf(String.valueOf(prod.get('SalesPrice')));
            oli.Quantity = Integer.valueOf(String.valueOf(prod.get('Quantity')));
            oli.Description = String.valueOf(prod.get('Variant'));
            oliList.add(oli);
        }

        // Insert OLIs
        insert oliList;

        // Re-query to get TotalPrice values
        List<OpportunityLineItem> insertedOLIs = [
            SELECT Id, Quantity, UnitPrice, TotalPrice, ListPrice
            FROM OpportunityLineItem
            WHERE Id IN :oliList
        ];

        // Create Sales Splits
        List<Sales_Split__c> salesSplitList = new List<Sales_Split__c>();

        for (Integer i = 0; i < insertedOLIs.size(); i++) {
            OpportunityLineItem oli = insertedOLIs[i];
            Map<String, Object> inputProd = products[i];

            Decimal listPrice = Decimal.valueOf(String.valueOf(inputProd.get('ListPrice')));
            Decimal salesPrice = Decimal.valueOf(String.valueOf(inputProd.get('SalesPrice')));
            Decimal tax = Decimal.valueOf(String.valueOf(inputProd.get('Tax')));
            Decimal splitAmount = (listPrice - salesPrice) * tax;

            Sales_Split__c ss = new Sales_Split__c();
            ss.Opportunity_Line_Item__c = oli.Id;
            ss.List_Price__c = listPrice;
            ss.Sales_Price__c = salesPrice;
            ss.Split_Amount__c = splitAmount.setScale(2);
            salesSplitList.add(ss);
        }

        insert salesSplitList;
    }
}
