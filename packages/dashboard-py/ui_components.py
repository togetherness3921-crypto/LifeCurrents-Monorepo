import customtkinter as ctk
import webbrowser

class JobListItem(ctk.CTkFrame):
    def __init__(self, master, job, on_toggle_ready, on_delete):
        super().__init__(master)
        
        self.job = job
        self.on_toggle_ready = on_toggle_ready
        self.on_delete = on_delete
        self.is_selected = ctk.BooleanVar(value=job.get('ready_for_integration', False))

        self.grid_columnconfigure(2, weight=1)

        # --- Checkbox ---
        can_be_selected = job.get('status') == 'completed' and job.get('preview_url')
        if can_be_selected:
            self.checkbox = ctk.CTkCheckBox(self, text="", variable=self.is_selected, command=self._on_checkbox_toggle)
            self.checkbox.grid(row=0, column=0, padx=10, pady=10, sticky="n")

        # --- Status Indicator ---
        self.status_indicator = ctk.CTkFrame(self, width=12, height=12, corner_radius=6)
        self.status_indicator.grid(row=0, column=1, padx=(0, 10), pady=12, sticky="n")
        self.update_status_color()

        # --- Details ---
        self.details_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.details_frame.grid(row=0, column=2, padx=10, pady=10, sticky="nsew")
        
        self.title_label = ctk.CTkLabel(self.details_frame, text=job.get('title', 'No Title'), anchor="w", font=ctk.CTkFont(weight="bold"))
        self.title_label.pack(fill="x")
        
        # --- Verification Steps (collapsible) ---
        verification_data = job.get('verification_steps')
        verification_steps = verification_data.get('steps', []) if isinstance(verification_data, dict) else []
        if verification_steps:
            self.verification_frame = ctk.CTkFrame(self.details_frame, fg_color="transparent")
            self.verification_frame.pack(fill="x", pady=(5, 0))
            self.verification_label = ctk.CTkLabel(self.verification_frame, text="Verification Steps ▼", anchor="w", text_color="gray", cursor="hand2")
            self.verification_label.pack(fill="x")
            self.verification_label.bind("<Button-1>", self.toggle_verification_steps)

            self.steps_container = ctk.CTkFrame(self.details_frame, fg_color="#333")
            self.steps_visible = False
            
            for i, step in enumerate(verification_steps, 1):
                step_label = ctk.CTkLabel(self.steps_container, text=f"{i}. {step}", anchor="w", wraplength=400)
                step_label.pack(fill="x", padx=10, pady=2)
        
        # --- Actions/Links ---
        self.actions_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.actions_frame.grid(row=0, column=3, padx=10, pady=10, sticky="n")

        if job.get('preview_url'):
            self.preview_link = ctk.CTkButton(self.actions_frame, text="View Preview", command=self._open_preview)
            self.preview_link.pack(side="left", padx=5)

        status_text = job.get('status', 'unknown').replace('active', 'in-progress').upper()
        self.status_label = ctk.CTkLabel(self.actions_frame, text=status_text)
        self.status_label.pack(side="left", padx=5)

        self.delete_button = ctk.CTkButton(self.actions_frame, text="X", width=28, command=self._on_delete_click)
        self.delete_button.pack(side="left", padx=5)


    def toggle_verification_steps(self, event=None):
        if self.steps_visible:
            self.steps_container.pack_forget()
            self.verification_label.configure(text="Verification Steps ▼")
        else:
            self.steps_container.pack(fill="x", pady=5, padx=10)
            self.verification_label.configure(text="Verification Steps ▲")
        self.steps_visible = not self.steps_visible

    def _on_checkbox_toggle(self):
        self.on_toggle_ready(self.job['id'], self.is_selected.get())

    def _on_delete_click(self):
        self.on_delete(self.job['id'])

    def _open_preview(self):
        webbrowser.open_new_tab(self.job['preview_url'])

    def update_status_color(self):
        status = self.job.get('status', 'cancelled')
        status_colors = {
            'pending': '#f0ad4e',
            'active': '#337ab7', # 'in-progress' will map here
            'completed': '#5cb85c',
            'failed': '#d9534f',
            'cancelled': '#777777'
        }
        color = status_colors.get(status, '#777777')
        self.status_indicator.configure(fg_color=color)
    
    def update_job_data(self, new_job):
        """Update the widget with new job data without recreating it."""
        old_status = self.job.get('status')
        new_status = new_job.get('status')
        
        # Update internal job reference
        self.job = new_job
        
        # Update title if changed
        new_title = new_job.get('title', 'No Title')
        if self.title_label.cget('text') != new_title:
            self.title_label.configure(text=new_title)
        
        # Update status label if changed
        new_status_text = new_status.replace('active', 'in-progress').upper()
        if self.status_label.cget('text') != new_status_text:
            self.status_label.configure(text=new_status_text)
        
        # Update status indicator color if status changed
        if old_status != new_status:
            self.update_status_color()
        
        # Update ready_for_integration checkbox state if changed
        new_ready_state = new_job.get('ready_for_integration', False)
        if self.is_selected.get() != new_ready_state:
            self.is_selected.set(new_ready_state)