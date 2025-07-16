import { LightningElement,track, api } from 'lwc';
import processInstruction from '@salesforce/apex/AIMetadataController.processInstruction';
import listAvailableProfiles from '@salesforce/apex/AIMetadataController.listAvailableProfiles';
import debugProfileResolution from '@salesforce/apex/AIMetadataController.debugProfileResolution';
import suggestCloneableProfiles from '@salesforce/apex/AIMetadataController.suggestCloneableProfiles';

export default class metadataAgent extends LightningElement {

    @track userInput = '';
    @track agentResponse = '';
    @track isLoading = false;
    @track error = null;
    @track result = null;
    @track debugProfileName = '';

    handleInputChange(event) {
        this.userInput = event.target.value;
    }

    handleSendMessage() {
        if (!this.userInput.trim()) {
            this.error = 'Please enter an instruction.';
            return;
        }

        this.isLoading = true;
        this.error = null;
        this.agentResponse = '';

        processInstruction({ instruction: this.userInput })
            .then(result => {
                this.agentResponse = result;
                this.isLoading = false;
            })
            .catch(error => {
                this.error = error.body?.message || error.message || 'Unknown error occurred';
                this.isLoading = false;
            });
    }

    @api
    listProfiles() {
        this.isLoading = true;
        this.error = null;
        
        listAvailableProfiles()
            .then(result => {
                this.result = result;
                this.isLoading = false;
            })
            .catch(error => {
                this.error = error.body?.message || error.message || 'Unknown error occurred';
                this.isLoading = false;
            });
    }

    handleDebugProfileInput(event) {
        this.debugProfileName = event.target.value;
    }

    debugProfile() {
        if (!this.debugProfileName.trim()) {
            this.error = 'Please enter a profile name to debug.';
            return;
        }

        this.isLoading = true;
        this.error = null;
        
        debugProfileResolution({ profileName: this.debugProfileName })
            .then(result => {
                this.result = result;
                this.isLoading = false;
            })
            .catch(error => {
                this.error = error.body?.message || error.message || 'Unknown error occurred';
                this.isLoading = false;
            });
    }

    suggestProfiles() {
        this.isLoading = true;
        this.error = null;
        
        suggestCloneableProfiles()
            .then(result => {
                this.result = result;
                this.isLoading = false;
            })
            .catch(error => {
                this.error = error.body?.message || error.message || 'Unknown error occurred';
                this.isLoading = false;
            });
    }


}