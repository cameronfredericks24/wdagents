public with sharing class UserPresenceController {
    @AuraEnabled(cacheable=true)
    public static List<UserStatusWrapper> getUserPresenceInfo() {
        List<UserStatusWrapper> userStatusList = new List<UserStatusWrapper>();
        Date today = Date.today();
        Date sevenDaysAgo = today.addDays(-7);

        for (User user : [SELECT Id, Name, LastLoginDate FROM User WHERE IsActive = true]) {
            UserStatusWrapper userStatus = new UserStatusWrapper();
            userStatus.Id = user.Id;
            userStatus.Name = user.Name;

            Date lastLoginDate = (user.LastLoginDate != null) ? user.LastLoginDate.date() : null;
            userStatus.LastLoginDate = lastLoginDate;

            if (lastLoginDate == today) {
                userStatus.Status = 'Active Today';
            } else if (lastLoginDate != null && lastLoginDate >= sevenDaysAgo) {
                userStatus.Status = 'Active This Week';
            } else {
                userStatus.Status = 'Inactive';
            }
            userStatusList.add(userStatus);
        }
        return userStatusList;
    }

    public class UserStatusWrapper {
        @AuraEnabled
        public Id Id { get; set; }
        @AuraEnabled
        public String Name { get; set; }
        @AuraEnabled
        public Date LastLoginDate { get; set; }
        @AuraEnabled
        public String Status { get; set; }
    }
}
