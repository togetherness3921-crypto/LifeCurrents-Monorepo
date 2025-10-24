import asyncio
from typing import Optional
from supabase import acreate_client, AsyncClient

class SupabaseManager:
    """
    Manager class for handling the async Supabase client lifecycle
    and realtime subscriptions, based on official patterns.
    """
    def __init__(self, url: str, key: str):
        self.url = url
        self.key = key
        self.client: Optional[AsyncClient] = None
        self.channel = None

    async def initialize(self):
        """Creates and initializes the asynchronous Supabase client."""
        print("[Supabase] Initializing async client...")
        self.client = await acreate_client(self.url, self.key)
        print("[Supabase] Client initialized.")

    async def fetch_initial_jobs(self):
        """Performs an asynchronous query to fetch the initial list of jobs."""
        if not self.client:
            raise RuntimeError("Client not initialized.")
        
        print("[Supabase] Fetching initial jobs...")
        try:
            response = await self.client.table('jobs').select('*').order('created_at', desc=True).execute()
            print(f"[Supabase] Found {len(response.data)} jobs.")
            return response.data
        except Exception as e:
            print(f"[Supabase] Error fetching initial jobs: {e}")
            raise

    async def setup_realtime_subscription(self, callback):
        """Subscribes to real-time database changes on the 'jobs' table."""
        if not self.client:
            raise RuntimeError("Client not initialized.")

        print("[Supabase] Setting up realtime subscription...")

        def handle_change(payload):
            # This is the generic callback that will be called for any change
            print(f"[Supabase] Realtime event received: {payload['eventType']}")
            callback(payload)

        channel_name = "jobs_changes"
        self.channel = self.client.channel(channel_name)
        
        await (
            self.channel
            .on_postgres_changes(
                event="*",
                schema="public",
                table="jobs",
                callback=handle_change
            )
            .subscribe()
        )
        print("[Supabase] Realtime listener is now active.")

    async def mark_jobs_as_ready(self, job_ids):
        """Updates the 'ready_for_integration' flag for the given job IDs."""
        if not self.client:
            raise RuntimeError("Client not initialized.")
            
        print(f"[Supabase] Marking jobs as ready: {job_ids}")
        try:
            await self.client.table('jobs').update({'ready_for_integration': True}).in_('id', job_ids).execute()
        except Exception as e:
            print(f"[Supabase] Error updating jobs to ready: {e}")
            raise

    async def delete_job(self, job_id: str):
        """Deletes a job record from the database."""
        if not self.client:
            raise RuntimeError("Client not initialized.")
        
        print(f"[Supabase] Deleting job: {job_id}")
        try:
            await self.client.table('jobs').delete().eq('id', job_id).execute()
        except Exception as e:
            print(f"[Supabase] Error deleting job: {e}")
            raise

    async def cleanup(self):
        """Properly cleans up resources before shutting down."""
        print("[Supabase] Cleaning up resources...")
        if self.channel and self.client:
            try:
                await self.client.remove_channel(self.channel)
                print("[Supabase] Channel removed.")
            except Exception as e:
                print(f"[Supabase] Error removing channel: {e}")
        
        if self.client:
            try:
                await self.client.auth.sign_out()
                print("[Supabase] Signed out.")
            except Exception as e:
                print(f"[Supabase] Error during sign out: {e}")
        
        print("[Supabase] Cleanup complete.")

