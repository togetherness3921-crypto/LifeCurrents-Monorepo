import customtkinter as ctk
from supabase_client import SupabaseManager
from ui_components import JobListItem
import threading
import queue
import requests
import asyncio
import subprocess
import atexit
from collections import defaultdict

# --- Global process list to ensure cleanup ---
running_processes = []

def cleanup_processes():
    print("Cleaning up running subprocesses...")
    for p in running_processes:
        if p.poll() is None: # Check if process is still running
            p.terminate()
            p.wait()
    print("Subprocesses cleaned up.")

atexit.register(cleanup_processes)
# ---

class App(ctk.CTk):
    def __init__(self, command_queue_put_func):
        super().__init__()

        self.supabase_client = None # Will be set later
        self.command_queue_put = command_queue_put_func
        self.jobs = {}
        self.job_widgets = {}
        self.selected_jobs = set()
        
        self.title("LifeCurrents Job Dashboard")
        self.geometry("1200x900")

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1) # Changed to give list more space

        # --- Job List ---
        self.create_job_list()

        self.update_queue = queue.Queue()
        self.after(100, self.process_queue)

        self.start_subprocesses()

    def start_subprocesses(self):
        print("Starting background services...")
        # Start Cloudflare Worker with UTF-8 encoding and error handling
        worker_command = "npm run dev --workspace=packages/worker -- --port 8787"
        worker_process = subprocess.Popen(worker_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='ignore')
        running_processes.append(worker_process)
        print(f"Started Cloudflare Worker with PID: {worker_process.pid}")

        # Start MCP Server with UTF-8 encoding and error handling
        mcp_command = "node packages/mcp-server/build/index.js"
        mcp_process = subprocess.Popen(mcp_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='ignore')
        running_processes.append(mcp_process)
        print(f"Started MCP Server with PID: {mcp_process.pid}")

        # It's good practice to monitor the output of these processes
        threading.Thread(target=self.log_subprocess_output, args=(worker_process, "Worker"), daemon=True).start()
        threading.Thread(target=self.log_subprocess_output, args=(mcp_process, "MCP"), daemon=True).start()

    def log_subprocess_output(self, process, name):
        if process.stdout:
            for line in iter(process.stdout.readline, ''):
                print(f"[{name}] {line.strip()}")
        if process.stderr:
            for line in iter(process.stderr.readline, ''):
                print(f"[{name} ERROR] {line.strip()}")

    def create_form(self):
        self.form_frame = ctk.CTkFrame(self)
        self.form_frame.grid(row=0, column=0, padx=20, pady=20, sticky="ew")
        self.form_frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(self.form_frame, text="Dispatch New Job", font=ctk.CTkFont(size=16, weight="bold")).grid(row=0, column=0, columnspan=2, pady=(10, 15))

        self.title_entry = ctk.CTkEntry(self.form_frame, placeholder_text="Job Title")
        self.title_entry.grid(row=1, column=0, columnspan=2, padx=10, pady=5, sticky="ew")

        self.prompt_text = ctk.CTkTextbox(self.form_frame, height=120)
        self.prompt_text.insert("1.0", "Development Prompt...")
        self.prompt_text.grid(row=2, column=0, columnspan=2, padx=10, pady=5, sticky="ew")

        self.verification_text = ctk.CTkTextbox(self.form_frame, height=60)
        self.verification_text.insert("1.0", "Verification Steps (one per line)...")
        self.verification_text.grid(row=3, column=0, columnspan=2, padx=10, pady=5, sticky="ew")

        self.dispatch_button = ctk.CTkButton(self.form_frame, text="Dispatch Job", command=self.dispatch_job)
        self.dispatch_button.grid(row=4, column=0, padx=10, pady=10, sticky="w")
        
        self.form_status_label = ctk.CTkLabel(self.form_frame, text="")
        self.form_status_label.grid(row=4, column=1, padx=10, pady=10, sticky="ew")

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

    def dispatch_job(self):
        title = self.title_entry.get()
        prompt = self.prompt_text.get("1.0", "end-1c")
        verification = self.verification_text.get("1.0", "end-1c")

        if not title or not prompt:
            self.form_status_label.configure(text="Title and Prompt are required.", text_color="red")
            return

        self.dispatch_button.configure(state="disabled", text="Dispatching...")
        self.form_status_label.configure(text="")
        
        worker_url = 'http://127.0.0.1:8787'
        verification_steps = [step.strip() for step in verification.split('\n') if step.strip()]
        
        payload = {
            "title": title,
            "prompt": prompt,
            "verification_steps": {"steps": verification_steps}
        }
        
        def do_dispatch():
            try:
                response = requests.post(f"{worker_url}/api/dispatch-job", json=payload, timeout=10)
                if response.status_code == 202:
                    self.form_status_label.configure(text="Job dispatched successfully!", text_color="green")
                    self.title_entry.delete(0, "end")
                    self.prompt_text.delete("1.0", "end")
                    self.verification_text.delete("1.0", "end")
                else:
                    self.form_status_label.configure(text=f"Error: {response.text}", text_color="red")
            except Exception as e:
                self.form_status_label.configure(text=f"Error: {str(e)}", text_color="red")
            finally:
                self.dispatch_button.configure(state="normal", text="Dispatch Job")

        threading.Thread(target=do_dispatch, daemon=True).start()

    def process_queue(self):
        try:
            while not self.update_queue.empty():
                update = self.update_queue.get_nowait()
                if update['type'] == 'INITIAL':
                    self.handle_initial_data(update['payload'])
                elif update['type'] == 'REALTIME':
                    self.handle_realtime_update(update['payload'])
        except queue.Empty:
            pass
        finally:
            self.after(100, self.process_queue)
            
    def handle_initial_data(self, jobs):
        self.jobs = {job['id']: job for job in jobs}
        self.render_all_jobs()

    def handle_realtime_update(self, payload):
        event_type = payload.get('type')
        record = payload.get('record', payload.get('old_record', {})) if event_type != 'DELETE' else payload.get('old_record', {})
        job_id = record.get('id')

        print(f"[UI] Realtime event: {event_type} for job {job_id}")

        if not job_id: 
            print("[UI] Received an event with no job ID, skipping.")
            return
        
        if event_type == 'INSERT':
            self.jobs[job_id] = record
            print(f"[UI] INSERTED job {job_id}. Total jobs: {len(self.jobs)}")
        elif event_type == 'UPDATE':
            if job_id in self.jobs:
                self.jobs[job_id] = {**self.jobs[job_id], **record}
                print(f"[UI] UPDATED job {job_id}.")
            else:
                self.jobs[job_id] = record # Handle case where an update comes before initial fetch
                print(f"[UI] INSERTED job {job_id} from an UPDATE event.")
        elif event_type == 'DELETE':
            if job_id in self.jobs:
                del self.jobs[job_id]
                print(f"[UI] DELETED job {job_id}. Total jobs: {len(self.jobs)}")
        
        self.render_all_jobs()
        
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
        job_ids = list(self.selected_jobs)
        if not job_ids:
            return
            
        self.reconciliation_button.configure(state="disabled", text="Marking...")
        
        command = {
            "type": "MARK_AS_READY",
            "payload": {"job_ids": job_ids}
        }
        self.command_queue_put(command)

        # The UI will update via realtime subscription, but we can reset the button state
        # after a short delay to provide feedback, or wait for a confirmation message.
        # For now, let's just optimistically reset it.
        self.selected_jobs.clear()
        self.reconciliation_button.configure(
            text="Mark 0 as Ready for Integration",
            state="disabled"
        )

    def delete_job(self, job_id):
        # Optimistic UI Update: remove the job from the local state immediately
        if job_id in self.jobs:
            del self.jobs[job_id]
            self.render_all_jobs()
            print(f"[UI] Optimistically removed job {job_id}.")

        # Send the command to the background thread to delete from the database
        command = {
            "type": "DELETE_JOB",
            "payload": {"job_id": job_id}
        }
        self.command_queue_put(command)

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
        print("Closing application and subprocesses...")
        if self.command_queue_put:
            self.command_queue_put({"type": "CLOSE"})
        
        # The atexit handler will take care of the subprocesses,
        # but we can also be explicit here.
        cleanup_processes()
        
        self.destroy()

async def process_commands(q, manager):
    while True:
        try:
            command = await q.get()
            if command['type'] == 'MARK_AS_READY':
                job_ids = command['payload']['job_ids']
                print(f"[UI->Async] Received command to mark jobs as ready: {job_ids}")
                await manager.mark_jobs_as_ready(job_ids)
            elif command['type'] == 'DELETE_JOB':
                job_id = command['payload']['job_id']
                print(f"[UI->Async] Received command to delete job: {job_id}")
                await manager.delete_job(job_id)
            elif command['type'] == 'CLOSE':
                print("[UI->Async] Received close command.")
                break
        except Exception as e:
            print(f"[Async] Error processing command: {e}")

def run_asyncio_loop(loop, update_q, command_q_async):
    asyncio.set_event_loop(loop)
    
    url = "https://cvzgxnspmmxxxwnxiydk.supabase.co"
    key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2emd4bnNwbW14eHh3bnhpeWRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4NzczNTgsImV4cCI6MjA3MjQ1MzM1OH0.2syXitu78TLVBu8hD7DfAC7h6CYvgyP-ZWcw9wY3xhU"
    manager = SupabaseManager(url, key)

    async def main():
        command_task = None
        try:
            await manager.initialize()
            
            initial_jobs = await manager.fetch_initial_jobs()
            update_q.put({'type': 'INITIAL', 'payload': initial_jobs})
            
            command_task = asyncio.create_task(process_commands(command_q_async, manager))
            
            await manager.setup_realtime_subscription(
                lambda payload: update_q.put({'type': 'REALTIME', 'payload': payload})
            )

            await command_task

        except Exception as e:
            print(f"[Async] A critical error occurred in the main async loop: {e}")
        finally:
            if command_task and not command_task.done():
                command_task.cancel()
            await manager.cleanup()

    loop.run_until_complete(main())

if __name__ == "__main__":
    # Use an asyncio queue for thread-safe async communication
    command_queue = asyncio.Queue()

    # The UI needs a way to put items onto the asyncio queue from a different thread
    def thread_safe_put(q_async, item, loop):
        asyncio.run_coroutine_threadsafe(q_async.put(item), loop)

    # Run asyncio loop in a background thread
    async_loop = asyncio.new_event_loop()
    
    # Create the app instance, passing it a function it can use to safely queue commands
    app = App(lambda item: thread_safe_put(command_queue, item, async_loop))

    async_thread = threading.Thread(
        target=run_asyncio_loop, 
        args=(async_loop, app.update_queue, command_queue), 
        daemon=True
    )
    async_thread.start()

    app.protocol("WM_DELETE_WINDOW", app.on_closing)
    app.mainloop()
