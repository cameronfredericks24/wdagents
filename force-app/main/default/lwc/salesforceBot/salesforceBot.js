// Simplified AI Object Builder
import { LightningElement, track } from "lwc";
import callNodeApi from "@salesforce/apex/ApprovalProcessProxy.callNodeApi";

export default class AiObjectBuilder extends LightningElement {
  @track prompt = "";
    @track isLoading = false;
  @track responseMessage = "";
  @track messageVariant = "slds-theme_info";
  @track details = null;

  get messageIcon() {
    switch (this.messageVariant) {
      case "slds-theme_success":
        return "utility:success";
      case "slds-theme_error":
        return "utility:error";
      case "slds-theme_warning":
        return "utility:warning";
      default:
        return "utility:info";
    }
  }

    handlePromptChange(event) {
        this.prompt = event.target.value;
    }

    async handleBuildObject() {
        if (!this.prompt) {
      this.responseMessage = "Please enter a description for the approval process or object.";
      this.messageVariant = "slds-theme_error";
            return;
        }

        this.isLoading = true;
    this.responseMessage = "Processing your request...";
    this.messageVariant = "slds-theme_info";
    this.details = null;

        try {
      const result = await callNodeApi({
        prompt: this.prompt,
        apiKey: "my-default-dev-key"
      });
            const parsed = JSON.parse(result);
            if (parsed.error) {
        if (parsed.error.includes("Authentication failed") || parsed.error.includes("401")) {
          this.responseMessage = "Authentication failed. Please check if the server is running and API key is correct.";
          this.messageVariant = "slds-theme_error";
        } else if (parsed.error.includes("Connection failed")) {
          this.responseMessage = "Cannot connect to server. Please ensure the Node.js server is running on localhost:3000.";
          this.messageVariant = "slds-theme_error";
        } else {
          this.responseMessage = `Error: ${parsed.details || parsed.error}`;
          this.messageVariant = "slds-theme_error";
        }
        return;
            }
      this.responseMessage = parsed.message || "Success! Your request has been processed.";
      this.messageVariant = "slds-theme_success";
      this.details = parsed.details || parsed.stdout || parsed || null;
      this.prompt = "";
        } catch (error) {
      console.error("Error calling backend:", error);
            this.responseMessage = `Error: ${error.message}`;
      this.messageVariant = "slds-theme_error";
      this.details = null;
        } finally {
            this.isLoading = false;
        }
    }

  handleClear() {
    this.prompt = "";
    this.responseMessage = "";
    this.details = null;
    this.messageVariant = "slds-theme_info";
  }

    get isButtonDisabled() {
        return !this.prompt || this.isLoading;
    }

    get messageClass() {
        return `slds-notify slds-notify_alert slds-m-top_medium ${this.messageVariant}`;
    }

  get detailsJson() {
    if (this.details) {
      if (typeof this.details === 'string') return this.details;
      return JSON.stringify(this.details, null, 2);
    }
    return '';
  }

  get formattedDetails() {
    if (!this.details || !Array.isArray(this.details.fields)) return this.details;
    // Map fields to include a formattedValues property
    return {
      ...this.details,
      fields: this.details.fields.map(field => ({
        ...field,
        formattedValues: Array.isArray(field.values) ? field.values.join(', ') : ''
      }))
    };
  }
}
