from django.core.management.base import BaseCommand
from django.contrib.sites.models import Site
from allauth.socialaccount.models import SocialApp
import os

class Command(BaseCommand):
    help = 'Initialize SocialApp and Site for Google OAuth'

    def handle(self, *args, **options):
        # 1. Setup Site
        # We try to determine the domain from an environment variable, 
        # otherwise we leave it as default or localhost.
        domain = os.environ.get('ADDON_DOMAIN', 'localhost:8000')
        site, created = Site.objects.get_or_create(id=1)
        site.domain = domain
        site.name = 'Budgeter'
        site.save()
        self.stdout.write(self.style.SUCCESS(f'Site configured with domain: {domain}'))

        # 2. Setup SocialApp
        client_id = os.environ.get('GOOGLE_CLIENT_ID')
        client_secret = os.environ.get('GOOGLE_CLIENT_SECRET')

        if not client_id or not client_secret:
            self.stdout.write(self.style.ERROR('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing or empty! Skipping SocialApp setup.'))
            self.stdout.write(f'Current GOOGLE_CLIENT_ID: "{client_id}"')
            return

        self.stdout.write(f'Setting up SocialApp with Client ID starting with: {client_id[:10]}...')

        app, created = SocialApp.objects.get_or_create(
            provider='google',
            defaults={
                'name': 'Google OAuth',
                'client_id': client_id,
                'secret': client_secret,
            }
        )

        if not created:
            app.client_id = client_id
            app.secret = client_secret
            app.save()

        app.sites.add(site)
        self.stdout.write(self.style.SUCCESS(f'SocialApp "{app.provider}" configured.'))
