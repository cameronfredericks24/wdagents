import { LightningElement, wire } from 'lwc';
import getUserPresenceInfo from '@salesforce/apex/UserPresenceController.getUserPresenceInfo';

export default class UserPresenceDashboard extends LightningElement {
    users = [];
    error;

    @wire(getUserPresenceInfo)
    wiredUsers({ error, data }) {
        if (data) {
            this.users = data.map(user => {
                let statusClass = 'slds-badge';
                let emoji = '❌';
                let displayStatus = user.Status;

                switch (user.Status) {
                    case 'Active Today':
                        statusClass += ' slds-theme_success';
                        emoji = '✅';
                        displayStatus = 'Logged in today 🎉';
                        break;
                    case 'Active This Week':
                        statusClass += ' slds-theme_warning';
                        emoji = '🕓';
                        displayStatus = 'Logged in this week';
                        break;
                    default:
                        statusClass += ' slds-theme_error';
                        emoji = '❌';
                        displayStatus = 'Inactive';
                        break;
                }

                const initials = user.Name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                const lastLoginDisplay = user.LastLoginDate ? new Date(user.LastLoginDate).toLocaleDateString() : 'Never Logged In';

                return {
                    ...user,
                    initials,
                    lastLoginDisplay,
                    statusClass,
                    Status: displayStatus,
                    emoji
                };
            });
            this.error = undefined;
        } else if (error) {
            this.error = error;
            this.users = [];
        }
    }
}
