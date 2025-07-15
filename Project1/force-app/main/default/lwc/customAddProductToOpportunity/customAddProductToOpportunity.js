import { LightningElement, api, track } from 'lwc';
import getSuggestedProducts from '@salesforce/apex/CustomProductSelectorController.getSuggestedProducts';
import saveOpportunityLineItems from '@salesforce/apex/CustomProductSelectorController.saveOpportunityLineItems';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
// import Amount from '@salesforce/schema/Opportunity.Amount';

export default class CustomAddProductToOpportunity extends LightningElement {
    @api recordId;
    @track products = [];

    validityOptions = [
        { label: '1 Month', value: '1 Month' },
        { label: '3 Months', value: '3 Months' },
        { label: '6 Months', value: '6 Months' },
        { label: '1 Year', value: '1 Year' }
    ];

    connectedCallback() {
        this.loadProducts();
    }

    loadProducts() {
        getSuggestedProducts({ opportunityId: this.recordId })
            .then(data => {
                this.products = data.map(prod => ({
                    ...prod,
                    Quantity: 1,
                    isSelected: false,
                    Variant: '',
                    Validity: '',
                    SalesPrice: 0,
                    ListPrice: prod.ListPrice || prod.Unit_List_Price__c || 0,
                    Tax: prod.Tax || prod.Tax__c || 0,
                    TotalPrice: 0
                }));
            })
            .catch(error => {
                this.showToast('Error loading products', error.body?.message || error.message, 'error');
            });
    }

    handleCheckboxChange(event) {
        const index = event.target.dataset.index;
        this.products[index].isSelected = event.target.checked;
    }

    handleInputChange(event) {
        const index = event.target.dataset.index;
        const field = event.target.name;
        let value = event.target.value;

        if (field === 'Quantity') {
            value = parseInt(value, 10);
            if (isNaN(value) || value < 1) value = 1;
        } else if (field === 'SalesPrice') {
            value = parseFloat(value);
            if (isNaN(value) || value < 0) value = 0;
        }

        this.products[index][field] = value;

        // Recalculate TotalPrice = Quantity * SalesPrice
        // Recalculate TotalPrice = Quantity * SalesPrice * (1 + Tax)
const qty = parseFloat(this.products[index].Quantity);
const price = parseFloat(this.products[index].SalesPrice);
let tax = parseFloat(this.products[index].Tax) || 0;
if (tax > 1) {
    tax = tax / 100; // Convert from 5 to 0.05 if needed
}

const totalWithTax = qty * price * (1 + tax);
this.products[index].TotalPrice = totalWithTax.toFixed(2);

    }

    handleSave() {
        const selected = this.products.filter(p => p.isSelected);

        if (selected.length === 0) {
            this.showToast('Validation Error', 'Please select at least one product.', 'error');
            return;
        }

        const cleanedProducts = [];

        for (let prod of selected) {
            if (!prod.Quantity || !prod.SalesPrice || !prod.Product2Id) {
                this.showToast('Validation Error', 'Please fill in Quantity, Sales Price, and ensure product is valid.', 'error');
                return;
            }

            try {
                cleanedProducts.push({
                    Product2Id: prod.Product2Id,
                    Variant: prod.Variant,
                    Quantity: parseInt(prod.Quantity, 10),
                    Validity: prod.Validity || '',
                    SalesPrice: parseFloat(prod.SalesPrice),
                    ListPrice: parseFloat(prod.ListPrice),
                    
                    Tax: parseFloat(prod.Tax),
                    Split_Amount__c:prod.qty * prod.price * (1 + prod.tax / 100), 
                });
            } catch (err) {
                this.showToast('Formatting Error', 'Check numeric fields for valid input.', 'error');
                return;
            }
        }

        saveOpportunityLineItems({ products: cleanedProducts, opportunityId: this.recordId })
            .then(() => {
                this.showToast('Success', 'Products added successfully', 'success');
                this.dispatchEvent(new CustomEvent('close'));
            })
            .catch(error => {
                this.showToast('Save Error', error.body?.message || 'An error occurred while saving.', 'error');
            });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
