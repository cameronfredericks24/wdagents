@isTest
public class UserPresenceControllerTest {
    @testSetup
    static void setupTestUsers() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];

        User todayUser = new User(
            ProfileId = p.Id,
            LastName = 'TodayUser',
            Email = 'todayuser@example.com',
            Username = 'todayuser' + DateTime.now().getTime() + '@example.com',
            Alias = 'tuser',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            IsActive = true
        );
        insert todayUser;

        User twoDaysAgoUser = new User(
            ProfileId = p.Id,
            LastName = 'TwoDaysAgoUser',
            Email = 'twodaysago@example.com',
            Username = 'twodaysago' + DateTime.now().getTime() + '@example.com',
            Alias = 'tdago',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            IsActive = true
        );
        insert twoDaysAgoUser;

        User tenDaysAgoUser = new User(
            ProfileId = p.Id,
            LastName = 'TenDaysAgoUser',
            Email = 'tendaysago@example.com',
            Username = 'tendaysago' + DateTime.now().getTime() + '@example.com',
            Alias = 'tdago2',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            IsActive = true
        );
        insert tenDaysAgoUser;

        // Can't set LastLoginDate (read-only), so can't test real login status here.
    }

    @isTest
    static void testGetUserPresenceInfo() {
        Test.startTest();

        List<UserPresenceController.UserStatusWrapper> users = UserPresenceController.getUserPresenceInfo();

        System.assert(users.size() > 0, 'Expected at least one user');

        for (UserPresenceController.UserStatusWrapper userWrapper : users) {
            System.assertNotEquals(null, userWrapper.Status, 'Status should not be null');
        }

        Test.stopTest();
    }
}
