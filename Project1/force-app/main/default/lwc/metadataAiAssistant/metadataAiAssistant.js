import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import generateMetadata from '@salesforce/apex/MetadataAiAssistantController.generateMetadata';
import deployMetadata from '@salesforce/apex/MetadataAiAssistantController.deployMetadata';
import checkDeploymentStatus from '@salesforce/apex/MetadataAiAssistantController.checkDeploymentStatus';

export default class MetadataAiAssistant extends LightningElement {
    @track prompt = 'Create a custom object for tracking Books, with fields for Title (Text), Author (Text), ISBN (Text, Unique), Published Date (Date), and Genre (Picklist with values Fiction, Non-Fiction, Sci-Fi, Fantasy).';
    @track metadataPreview = '';
    @track isLoading = false;
    @track isDeploying = false;
    @track deploymentStatus = '';
    @track resultMessage = '';
    jobId;

    get displayMetadataPreview() {
        // If the preview is JSON, show as string; if XML, show as is
        if (typeof this.metadataPreview === 'object') {
            // Try to extract XML from a property, or stringify
            if (this.metadataPreview.metadataPreview) {
                return this.metadataPreview.metadataPreview;
            }
            return JSON.stringify(this.metadataPreview, null, 2);
        }
        return this.metadataPreview;
    }

    handlePromptChange(event) {
        this.prompt = event.target.value;
    }

    async handleGenerate() {
        if (!this.prompt) {
            this.showToast('Error', 'Please enter a prompt.', 'error');
            return;
        }
        this.isLoading = true;
        this.metadataPreview = '';
        try {
            const xmlString = await generateMetadata({ prompt: this.prompt });
            this.metadataPreview = xmlString;
        } catch (error) {
            console.error('Full error object from generateMetadata:', JSON.parse(JSON.stringify(error)));
            this.showToast('Error Generating Metadata', this.getErrorMessage(error), 'error');
            this.metadataPreview = '';
        } finally {
            this.isLoading = false;
        }
    }

    async handleDeploy() {
        if (!this.metadataPreview) {
            this.showToast('Error', 'No metadata to deploy. Please generate it first.', 'error');
            return;
        }
        this.isDeploying = true;
        this.deploymentStatus = 'Starting deployment...';
        try {
            const result = await deployMetadata({ metadata: this.metadataPreview });
            if (result.jobId) {
                this.jobId = result.jobId;
                this.deploymentStatus = `Deployment in progress. Job ID: ${this.jobId}`;
                this.pollDeploymentStatus();
            } else {
                throw new Error(result.error || 'Failed to start deployment.');
            }
        } catch (error) {
            console.error('Full error object from deployMetadata:', JSON.parse(JSON.stringify(error)));
            this.showToast('Error Deploying Metadata', this.getErrorMessage(error), 'error');
            this.isDeploying = false;
        }
    }

    pollDeploymentStatus() {
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        const poll = setInterval(async () => {
            if (!this.jobId) {
                clearInterval(poll);
                return;
            }
            try {
                const result = await checkDeploymentStatus({ jobId: this.jobId });
                const parsedResult = JSON.parse(result);
                this.deploymentStatus = `Status: ${parsedResult.status}.`;
                // Log detailed result to console only
                console.log('Deployment Result:', parsedResult.result || '');
                if (parsedResult.status === 'success' || parsedResult.status === 'failed' || parsedResult.status === 'not_found') {
                    this.isDeploying = false;
                    this.jobId = null;
                    clearInterval(poll);
                    // Show only a simple success or failure message in the UI
                    this.showToast(
                        parsedResult.status === 'success' ? 'Deployment successful' : 'Deployment failed',
                        '',
                        parsedResult.status === 'success' ? 'success' : 'error'
                    );
                }
            } catch (error) {
                console.error('Full error object from pollDeploymentStatus:', JSON.parse(JSON.stringify(error)));
                this.showToast('Error Checking Status', this.getErrorMessage(error), 'error');
                this.isDeploying = false;
                this.jobId = null;
                clearInterval(poll);
            }
        }, 5000); // Poll every 5 seconds
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    getErrorMessage(error) {
        if (error.body && error.body.message) {
            // AuraHandledException
            return error.body.message;
        }
        if (error.message) {
            // Javascript error
            return error.message;
        }
        return 'An unknown error occurred.';
    }
} 