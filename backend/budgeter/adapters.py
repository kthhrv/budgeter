from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.conf import settings
from django.core.exceptions import PermissionDenied

class WhitelistedSocialAccountAdapter(DefaultSocialAccountAdapter):
    def pre_social_login(self, request, sociallogin):
        """
        Check if the user's email is in the allowed whitelist.
        """
        email = sociallogin.account.extra_data.get('email')
        allowed_emails = getattr(settings, 'ALLOWED_GOOGLE_EMAILS', [])
        
        if email not in allowed_emails:
            raise PermissionDenied(f"Email {email} is not in the allowed whitelist.")
