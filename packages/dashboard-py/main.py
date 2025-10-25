import customtkinter as ctk
from supabase_client import SupabaseManager
from ui_components import JobListItem
import threading
import queue
import asyncio
import subprocess
import atexit
from collections import defaultdict
import pygame
import os

# --- Global process list to ensure cleanup ---
running_processes = []

def cleanup_processes():
    print("[Cleanup] Terminating background services...")
    for p in running_processes:
        if p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print(f"[Cleanup] Process {p.pid} did not terminate gracefully, forcing kill...")
                p.kill()
    print("[Cleanup] All subprocesses cleaned up.")

atexit.register(cleanup_processes)

class AsyncioThread(threading.Thread):
    """
    Canonical asyncio background thread following best practices.
    Runs the Supabase manager and communicates with the main UI via queue.
    """
    def __init__(self, update_queue):
        super().__init__(daemon=True)
        self.update_queue = update_queue
        self.loop = None
        self.manager = None
        self.shutdown_event = None

    def run(self):
        """Entry point for the asyncio thread."""
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.shutdown_event = asyncio.Event()
        
        url = "https://cvzgxnspmmxxxwnxiydk.supabase.co"
        key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2emd4bnNwbW14eHh3bnhpeWRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4NzczNTgsImV4cCI6MjA3MjQ1MzM1OH0.2syXitu78TLVBu8hD7DfAC7h6CYvgyP-ZWcw9wY3xhU"
        self.manager = SupabaseManager(url, key)
        
        try:
            self.loop.run_until_complete(self.async_main())
        except Exception as e:
            print(f"[Async] Critical error: {e}")
        finally:
            self.loop.close()

    async def async_main(self):
        """Main async coroutine."""
        try:
            print("[Async] Initializing Supabase manager...")
            await self.manager.initialize()
            
            # Fetch initial jobs and send to UI via queue
            print("[Async] Fetching initial jobs...")
            initial_jobs = await self.manager.fetch_initial_jobs()
            print(f"[Async→Queue] Sending {len(initial_jobs)} initial jobs to UI queue")
            self.update_queue.put({'type': 'INITIAL', 'payload': initial_jobs})
            print(f"[Async→Queue] Initial jobs added. Queue size: {self.update_queue.qsize()}")
            
            # Start polling for updates
            print("[Async] Starting polling for job updates...")
            await self.manager.start_polling(self.handle_polling_update, interval_seconds=5)

        except Exception as e:
            print(f"[Async] Error in main loop: {e}")
            import traceback
            traceback.print_exc()
        finally:
            print("[Async] Cleaning up...")
            await self.manager.cleanup()

    def handle_polling_update(self, jobs):
        """Callback for polling updates - send full job list to UI via queue."""
        print(f"[Async→Queue] Poll update: {len(jobs)} jobs")
        self.update_queue.put({'type': 'POLL', 'payload': jobs})
        print(f"[Async→Queue] Poll data added to queue. Queue size: {self.update_queue.qsize()}")

    def delete_job(self, job_id):
        """Thread-safe method to delete a job from UI thread."""
        if self.loop and self.manager:
            asyncio.run_coroutine_threadsafe(self.manager.delete_job(job_id), self.loop)

    def mark_as_ready(self, job_ids):
        """Thread-safe method to mark jobs as ready from UI thread."""
        if self.loop and self.manager:
            asyncio.run_coroutine_threadsafe(self.manager.mark_jobs_as_ready(job_ids), self.loop)

    def stop(self):
        """Signal the async thread to stop gracefully."""
        if self.loop and self.shutdown_event:
            self.loop.call_soon_threadsafe(self.shutdown_event.set)

class App(ctk.CTk):
    """
    Main CustomTkinter application following the canonical asyncio integration pattern.
    """
    def __init__(self):
        super().__init__()
        
        # Application state
        self.is_closing = False
        self.jobs = {}
        self.job_widgets = {}
        self.selected_jobs = set()
        self.previous_job_states = {}  # Track job states to detect new completions
        
        # Thread-safe queue for asyncio → UI communication (canonical pattern)
        self.update_queue = queue.Queue()
        
        # Asyncio thread reference
        self.async_thread = None
        
        # Initialize sound notifications
        try:
            pygame.mixer.init()
            completion_sound_path = os.path.join(os.path.dirname(__file__), "microwave-ding-104123.mp3")
            new_job_sound_path = os.path.join(os.path.dirname(__file__), "ui-sounds-pack-2-sound-1-358893.mp3")
            
            self.completion_sound = pygame.mixer.Sound(completion_sound_path)
            self.new_job_sound = pygame.mixer.Sound(new_job_sound_path)
            
            print(f"[Sound] Completion sound loaded from: {completion_sound_path}")
            print(f"[Sound] New job sound loaded from: {new_job_sound_path}")
        except Exception as e:
            print(f"[Sound] Warning: Could not initialize sounds: {e}")
            self.completion_sound = None
            self.new_job_sound = None
        
        # UI Setup
        self.title("LifeCurrents Job Dashboard")
        self.geometry("1200x900")
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # Create UI components
        self.create_job_list()
        
        # Start background services
        self.start_subprocesses()
        
        # Start asyncio thread
        self.start_async_thread()
        
        # Start queue processing (canonical polling pattern)
        print("[Init] Starting queue processing loop...")
        self.process_queue()
        print("[Init] Queue processing loop initiated.")
        
        # Setup graceful shutdown
        self.protocol("WM_DELETE_WINDOW", self.on_closing)

    def start_subprocesses(self):
        """Start the Cloudflare Worker and MCP Server as background processes."""
        print("[Init] Starting background services...")
        
        # Start Cloudflare Worker
        worker_command = "npm run dev --workspace=packages/worker -- --port 8787"
        worker_process = subprocess.Popen(
            worker_command, 
            shell=True, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE, 
            text=True, 
            encoding='utf-8', 
            errors='ignore'
        )
        running_processes.append(worker_process)
        print(f"[Init] Cloudflare Worker started (PID: {worker_process.pid})")
        
        # Start MCP Server
        mcp_command = "node packages/mcp-server/build/index.js"
        mcp_process = subprocess.Popen(
            mcp_command, 
            shell=True, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE, 
            text=True, 
            encoding='utf-8', 
            errors='ignore'
        )
        running_processes.append(mcp_process)
        print(f"[Init] MCP Server started (PID: {mcp_process.pid})")
        
        # Monitor subprocess output in background threads
        threading.Thread(target=self.log_subprocess_output, args=(worker_process, "Worker"), daemon=True).start()
        threading.Thread(target=self.log_subprocess_output, args=(mcp_process, "MCP"), daemon=True).start()

    def log_subprocess_output(self, process, name):
        """Monitor and log subprocess output."""
        if process.stdout:
            for line in iter(process.stdout.readline, ''):
                if line:
                    print(f"[{name}] {line.strip()}")
        if process.stderr:
            for line in iter(process.stderr.readline, ''):
                if line:
                    print(f"[{name} ERROR] {line.strip()}")
    
    def start_async_thread(self):
        """Start the asyncio background thread (canonical pattern)."""
        print("[Init] Starting asyncio thread...")
        print(f"[Init] Update queue object: {self.update_queue}")
        self.async_thread = AsyncioThread(self.update_queue)
        self.async_thread.start()
        print(f"[Init] Asyncio thread started. Thread alive: {self.async_thread.is_alive()}")


    def create_job_list(self):
        self.list_container = ctk.CTkFrame(self)
        self.list_container.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        self.list_container.grid_columnconfigure(0, weight=1)
        self.list_container.grid_rowconfigure(1, weight=1)

        header_frame = ctk.CTkFrame(self.list_container)
        header_frame.grid(row=0, column=0, padx=10, pady=10, sticky="ew")
        header_frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(header_frame, text="Job Queue", font=ctk.CTkFont(size=16, weight="bold")).grid(row=0, column=0, sticky="w")
        
        self.reconciliation_button = ctk.CTkButton(header_frame, text="Mark 0 as Ready for Integration", command=self.mark_as_ready, state="disabled")
        self.reconciliation_button.grid(row=0, column=1, sticky="e")

        self.scrollable_frame = ctk.CTkScrollableFrame(self.list_container, fg_color="transparent")
        self.scrollable_frame.grid(row=1, column=0, padx=0, pady=(0, 10), sticky="nsew")
        self.scrollable_frame.grid_columnconfigure(0, weight=1)

    def process_queue(self):
        """
        Canonical queue processing pattern.
        Polls the queue for updates from the asyncio thread and updates the UI.
        """
        messages_processed = 0
        try:
            # Process all messages currently in the queue (non-blocking)
            while True:
                update = self.update_queue.get_nowait()
                messages_processed += 1
                
                print(f"[Queue→UI] Processing message #{messages_processed}: {update['type']}")
                
                if update['type'] == 'INITIAL':
                    print(f"[Queue→UI] Handling INITIAL data with {len(update['payload'])} jobs")
                    self.handle_initial_data(update['payload'], is_initial=True)
                elif update['type'] == 'POLL':
                    print(f"[Queue→UI] Handling POLL update with {len(update['payload'])} jobs")
                    self.handle_initial_data(update['payload'], is_initial=False)
                elif update['type'] == 'REALTIME':
                    print(f"[Queue→UI] Handling REALTIME update")
                    self.handle_realtime_update(update['payload'])
                    
        except queue.Empty:
            # Queue is empty, which is normal
            if messages_processed > 0:
                print(f"[Queue→UI] Processed {messages_processed} messages. Queue now empty.")
        
        # Schedule next poll (100ms is a good balance)
        # Only continue if window still exists
        if self.winfo_exists() and not self.is_closing:
            self.after(100, self.process_queue)
            
    def handle_initial_data(self, jobs, is_initial=True):
        print(f"[UI] handle_initial_data called with {len(jobs)} jobs (is_initial={is_initial})")
        
        new_jobs = {job['id']: job for job in jobs}
        
        # Detect newly completed jobs
        newly_completed = []
        for job in jobs:
            job_id = job['id']
            current_status = job.get('status')
            previous_status = self.previous_job_states.get(job_id)
            
            # Check if job just became completed
            if current_status == 'completed' and previous_status != 'completed':
                newly_completed.append(job)
                print(f"[UI] 🎉 Job {job_id} just completed!")
        
        # Play notification if there are new completions and window not focused
        if newly_completed and not self.is_window_focused():
            self.play_completion_sound()
            print(f"[Sound] Played completion sound for {len(newly_completed)} newly completed job(s)")
        
        # On initial load, just render everything
        if is_initial or not self.jobs:
            self.jobs = new_jobs
            self.previous_job_states = {job['id']: job.get('status') for job in jobs}
            print(f"[UI] Initial render with {len(self.jobs)} jobs")
            self.render_all_jobs()
            return
        
        # Smart update: only touch what changed
        old_job_ids = set(self.jobs.keys())
        new_job_ids = set(new_jobs.keys())
        
        # Find changes
        added_ids = new_job_ids - old_job_ids
        removed_ids = old_job_ids - new_job_ids
        potential_updates = new_job_ids & old_job_ids
        
        # Filter to only jobs that actually changed
        changed_ids = []
        for job_id in potential_updates:
            if self.jobs[job_id] != new_jobs[job_id]:
                changed_ids.append(job_id)
        
        # Update internal state
        self.jobs = new_jobs
        self.previous_job_states = {job['id']: job.get('status') for job in jobs}
        
        # If there are any changes, update UI selectively
        if added_ids or removed_ids or changed_ids:
            print(f"[UI] Smart update: {len(added_ids)} added, {len(removed_ids)} removed, {len(changed_ids)} changed")
            
            # Play sound for newly added jobs if window not focused
            if added_ids and not self.is_window_focused():
                self.play_new_job_sound()
                print(f"[Sound] Played new job sound for {len(added_ids)} new job(s)")
            
            self.update_jobs_incrementally(added_ids, removed_ids, changed_ids)
        else:
            print(f"[UI] No changes detected, skipping UI update")

    def handle_realtime_update(self, payload):
        print(f"[UI] handle_realtime_update called")
        print(f"[UI] Payload received: {payload}")
        
        event_type = payload.get('eventType')  # Note: Supabase uses 'eventType', not 'type'
        
        if not event_type:
            print(f"[UI] WARNING: No eventType in payload. Keys present: {list(payload.keys())}")
            return
        
        print(f"[UI] Event type: {event_type}")
        
        # Supabase realtime payload structure
        if event_type == 'INSERT':
            record = payload.get('new', {})
        elif event_type == 'UPDATE':
            record = payload.get('new', {})
        elif event_type == 'DELETE':
            record = payload.get('old', {})
        else:
            print(f"[UI] Unknown event type: {event_type}")
            return
        
        job_id = record.get('id')
        print(f"[UI] Job ID: {job_id}")

        if not job_id: 
            print("[UI] ERROR: Received an event with no job ID, skipping.")
            print(f"[UI] Record content: {record}")
            return
        
        if event_type == 'INSERT':
            self.jobs[job_id] = record
            print(f"[UI] ✅ INSERTED job {job_id}. Total jobs: {len(self.jobs)}")
        elif event_type == 'UPDATE':
            if job_id in self.jobs:
                self.jobs[job_id] = {**self.jobs[job_id], **record}
                print(f"[UI] ✅ UPDATED job {job_id}.")
            else:
                self.jobs[job_id] = record
                print(f"[UI] ✅ INSERTED job {job_id} from an UPDATE event.")
        elif event_type == 'DELETE':
            if job_id in self.jobs:
                del self.jobs[job_id]
                print(f"[UI] ✅ DELETED job {job_id}. Total jobs: {len(self.jobs)}")
        
        print(f"[UI] Calling render_all_jobs()...")
        self.render_all_jobs()
        print(f"[UI] render_all_jobs() completed")
    
    def update_jobs_incrementally(self, added_ids, removed_ids, changed_ids):
        """
        Update only the jobs that changed, without destroying the entire UI.
        This prevents disruption during user interaction.
        """
        # Remove deleted jobs
        for job_id in removed_ids:
            if job_id in self.job_widgets:
                widget = self.job_widgets[job_id]
                widget.destroy()
                del self.job_widgets[job_id]
                print(f"[UI] Removed widget for job {job_id}")
        
        # Update changed jobs
        for job_id in changed_ids:
            if job_id in self.job_widgets:
                # Update the existing widget with new data
                widget = self.job_widgets[job_id]
                widget.update_job_data(self.jobs[job_id])
                print(f"[UI] Updated widget for job {job_id}")
        
        # If we added or removed jobs, we need to re-render (to handle grouping)
        # But only if the structure changed significantly
        if added_ids or removed_ids:
            print(f"[UI] Jobs added/removed, doing full re-render to maintain grouping")
            self.render_all_jobs()
    
    def is_window_focused(self):
        """Check if the dashboard window is currently focused."""
        try:
            # In Tkinter, focus_get() returns the widget with focus, or None
            return self.focus_get() is not None
        except:
            return False
    
    def play_completion_sound(self):
        """Play the job completion sound."""
        if self.completion_sound:
            try:
                self.completion_sound.play()
                print("[Sound] 🔔 Completion sound played")
            except Exception as e:
                print(f"[Sound] Error playing completion sound: {e}")
    
    def play_new_job_sound(self):
        """Play the new job dispatched sound."""
        if self.new_job_sound:
            try:
                self.new_job_sound.play()
                print("[Sound] 🔊 New job sound played")
            except Exception as e:
                print(f"[Sound] Error playing new job sound: {e}")
        
    def on_toggle_ready(self, job_id, is_selected):
        if is_selected:
            self.selected_jobs.add(job_id)
        else:
            self.selected_jobs.discard(job_id)
        
        count = len(self.selected_jobs)
        self.reconciliation_button.configure(
            text=f"Mark {count} as Ready for Integration",
            state="normal" if count > 0 else "disabled"
        )
        
    def mark_as_ready(self):
        """Mark selected jobs as ready for integration."""
        job_ids = list(self.selected_jobs)
        if not job_ids:
            return
            
        print(f"[UI] Marking {len(job_ids)} jobs as ready for integration...")
        self.reconciliation_button.configure(state="disabled", text="Marking...")
        
        # Call the async thread method (thread-safe)
        if self.async_thread:
            self.async_thread.mark_as_ready(job_ids)
        
        # Optimistically reset UI
        self.selected_jobs.clear()
        self.reconciliation_button.configure(
            text="Mark 0 as Ready for Integration",
            state="disabled"
        )

    def delete_job(self, job_id):
        """Delete a job (optimistic UI update + async database delete)."""
        print(f"[UI] Deleting job {job_id}...")
        
        # Optimistic UI update
        if job_id in self.jobs:
            del self.jobs[job_id]
            self.render_all_jobs()
            print(f"[UI] Job {job_id} removed from UI.")
        
        # Call the async thread method (thread-safe)
        if self.async_thread:
            self.async_thread.delete_job(job_id)

    def render_all_jobs(self):
        # Clear existing widgets first to prevent memory leaks
        for child in self.scrollable_frame.winfo_children():
            child.destroy()
        self.job_widgets = {}

        # Group jobs by base_version
        grouped_jobs = defaultdict(list)
        for job in self.jobs.values():
            grouped_jobs[job.get('base_version', 'Unknown')].append(job)

        # Sort groups by the most recent job within them
        sorted_groups = sorted(grouped_jobs.items(), key=lambda item: max(j['created_at'] for j in item[1]), reverse=True)

        for i, (base_version, jobs_in_group) in enumerate(sorted_groups):
            group_frame = ctk.CTkFrame(self.scrollable_frame)
            group_frame.grid(row=i, column=0, padx=10, pady=(10, 5), sticky="ew")
            group_frame.grid_columnconfigure(0, weight=1)

            # --- Group Header ---
            header = ctk.CTkLabel(group_frame, text=f"Base Version: {base_version}", font=ctk.CTkFont(weight="bold"))
            header.pack(fill="x", padx=10, pady=5)
            
            # Sort jobs within the group
            sorted_jobs = sorted(jobs_in_group, key=lambda j: j['created_at'], reverse=True)
            
            for job in sorted_jobs:
                job_id = job['id']
                job_widget = JobListItem(
                    group_frame, 
                    job, 
                    on_toggle_ready=self.on_toggle_ready, 
                    on_delete=self.delete_job
                )
                job_widget.pack(fill="x", padx=10, pady=5)
                self.job_widgets[job_id] = job_widget
    
    def on_closing(self):
        """
        Graceful shutdown handler following the canonical pattern.
        """
        print("[Shutdown] Initiating graceful shutdown...")
        self.is_closing = True
        
        # 1. Stop the asyncio thread
        if self.async_thread and self.async_thread.is_alive():
            print("[Shutdown] Stopping asyncio thread...")
            self.async_thread.stop()
            self.async_thread.join(timeout=3.0)
            if self.async_thread.is_alive():
                print("[Shutdown] Warning: Asyncio thread did not stop gracefully.")
        
        # 2. Terminate background processes
        print("[Shutdown] Terminating background processes...")
        cleanup_processes()
        
        # 3. Cleanup pygame
        try:
            pygame.mixer.quit()
            print("[Shutdown] Pygame mixer cleaned up.")
        except:
            pass
        
        # 4. Destroy the tkinter window
        print("[Shutdown] Closing application window...")
        self.destroy()
        print("[Shutdown] Shutdown complete.")


if __name__ == "__main__":
    """
    Application entry point.
    Follows the canonical tkinter + asyncio integration pattern.
    """
    print("[Main] Starting LifeCurrents Job Dashboard...")
    app = App()
    app.mainloop()
    print("[Main] Application exited.")
