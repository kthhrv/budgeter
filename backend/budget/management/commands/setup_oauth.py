from django.core.management.base import BaseCommand
from django.contrib.sites.models import Site
from allauth.socialaccount.models import SocialApp
import os

class Command(BaseCommand):
    help = 'Initialize SocialApp and Site for Google OAuth'

    def handle(self, *args, **options):
        # 1. Setup Site
        # Use the actual external domain if provided, otherwise fallback
        domain = os.environ.get('ADDON_DOMAIN', 'localhost:8000')
        site, created = Site.objects.get_or_create(id=1)
        site.domain = domain
        site.name = 'Budgeter'
        site.save()
        self.stdout.write(self.style.SUCCESS(f'Site ID 1 configured with domain: {domain}'))

        # 2. Setup SocialApp
        client_id = os.environ.get('GOOGLE_CLIENT_ID')
        client_secret = os.environ.get('GOOGLE_CLIENT_SECRET')

        if not client_id or not client_secret:
            self.stdout.write(self.style.ERROR('FATAL: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing or empty!'))
            self.stdout.write(f'Environment check: ID length={len(client_id) if client_id else 0}, Secret length={len(client_secret) if client_secret else 0}')
            return

        self.stdout.write(f'Updating SocialApp "google" with Client ID: {client_id[:10]}...')
        
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
            app.name = 'Google OAuth'
            app.save()

        # Ensure the app is linked to the site
        if not app.sites.filter(id=site.id).exists():
            app.sites.add(site)
            
        self.stdout.write(self.style.SUCCESS(f'SocialApp "{app.provider}" successfully configured and linked to Site 1.'))
