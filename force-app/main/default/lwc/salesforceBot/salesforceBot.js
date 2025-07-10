// aiObjectBuilder.js
import { LightningElement, track } from 'lwc';
// We need an Apex class to make the callout
// import makeApiCallout from '@salesforce/apex/AIObjectBuilderController.buildObject';

export default class AiObjectBuilder extends LightningElement {
    @track prompt = '';
    @track isLoading = false;
    @track responseMessage = '';
    @track messageVariant = 'slds-theme_info'; // slds-theme_success, slds-theme_error

    handlePromptChange(event) {
        this.prompt = event.target.value;
    }

    async handleBuildObject() {
        if (!this.prompt) {
            this.responseMessage = 'Please enter a description for the object.';
            this.messageVariant = 'slds-theme_error';
            return;
        }

        this.isLoading = true;
        this.responseMessage = '';

        try {
            // In a real scenario, you'd call Apex here.
            // For a direct-to-NodeJS demo (requires CORS & Remote Site Settings), it would look like this:
            const response = await fetch('https://2c10a72c9774.ngrok-free.app/api/generate-metadata', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ prompt: this.prompt }),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.details || 'Unknown error occurred.');
            }

            this.responseMessage = 'Success! The object has been deployed to your org.';
            this.messageVariant = 'slds-theme_success';
            
        } catch (error) {
            this.responseMessage = `Error: ${error.message}`;
            this.messageVariant = 'slds-theme_error';
            console.error('Error calling backend:', error);
        } finally {
            this.isLoading = false;
        }
    }

    get isButtonDisabled() {
        return !this.prompt || this.isLoading;
    }

    get messageClass() {
        return `slds-notify slds-notify_alert slds-m-top_medium ${this.messageVariant}`;
    }
}