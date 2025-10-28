"""
Modern UI Components for LifeCurrents Job Dashboard
Redesigned with refined aesthetics while maintaining all functionality
"""
import customtkinter as ctk
import webbrowser


class ModernJobCard(ctk.CTkFrame):
    """
    Modern, card-based job item with refined aesthetics.
    Maintains all original functionality with improved visual design.
    """
    
    # Modern color palette
    COLORS = {
        'card_bg': '#1e1e1e',
        'card_hover': '#252525',
        'border': '#2d2d2d',
        'text_primary': '#ffffff',
        'text_secondary': '#a0a0a0',
        'accent_blue': '#3498db',
        'accent_blue_hover': '#2980b9',
        'accent_green': '#27ae60',
        'accent_green_hover': '#229954',
        'accent_red': '#e74c3c',
        'accent_red_hover': '#c0392b',
        'accent_orange': '#f39c12',
        'status_active': '#3498db',
        'status_review': '#f39c12',
        'status_integrated': '#27ae60',
        'status_failed': '#e74c3c',
        'status_cancelled': '#7f8c8d',
        'verification_bg': '#2a2a2a',
    }
    
    def __init__(self, master, job, on_toggle_ready, on_delete):
        super().__init__(
            master,
            fg_color=self.COLORS['card_bg'],
            border_width=1,
            border_color=self.COLORS['border'],
            corner_radius=8
        )
        
        self.job = job
        self.on_toggle_ready = on_toggle_ready
        self.on_delete = on_delete
        self.is_verified = job.get('ready_for_integration', False)
        self.step_checkboxes = []  # Track verification step checkboxes
        self.verified_button = None  # Will be created if verification steps exist
        self.steps_visible = False
        
        # Configure grid
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)
        
        # Build card content
        self._build_card()
    
    def _build_card(self):
        """Build the complete card layout."""
        # Left section: Status badge
        self._create_status_section()
        
        # Middle section: Content (title + verification steps)
        self._create_content_section()
        
        # Right section: Actions
        self._create_actions_section()
    
    def _create_status_section(self):
        """Create the status badge on the left."""
        status_container = ctk.CTkFrame(self, fg_color="transparent")
        status_container.grid(row=0, column=0, padx=(16, 12), pady=15, sticky="n")
        
        # Status badge with text
        status = self.job.get('status', 'unknown')
        status_text, status_color = self._get_status_display(status)
        
        self.status_badge = ctk.CTkLabel(
            status_container,
            text=status_text,
            fg_color=status_color,
            text_color=self.COLORS['text_primary'],
            corner_radius=5,
            padx=12,
            pady=5,
            font=ctk.CTkFont(size=10, weight="bold")
        )
        self.status_badge.pack()
    
    def _create_content_section(self):
        """Create the main content area with title and verification steps."""
        content_frame = ctk.CTkFrame(self, fg_color="transparent")
        content_frame.grid(row=0, column=1, padx=12, pady=15, sticky="nsew")
        
        # Title (selectable textbox)
        title_text = self.job.get('title', 'No Title')
        self.title_label = ctk.CTkTextbox(
            content_frame,
            height=25,
            fg_color="transparent",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color=self.COLORS['text_primary'],
            wrap="word",
            activate_scrollbars=False
        )
        self.title_label.insert("1.0", title_text)
        self.title_label.configure(state="disabled")  # Read-only but selectable
        self.title_label.pack(fill="x", pady=(0, 6))
        
        # Metadata row (created time, PR number, etc.)
        self._create_metadata_row(content_frame)
        
        # Verification steps (collapsible)
        self._create_verification_steps(content_frame)
    
    def _create_metadata_row(self, parent):
        """Create metadata row with job info (selectable)."""
        # Build metadata text
        metadata_parts = []
        
        created_at = self.job.get('created_at', '')
        if created_at:
            metadata_parts.append(f"🕐 {created_at[:10]}")
        
        pr_number = self.job.get('pr_number')
        if pr_number:
            metadata_parts.append(f"PR #{pr_number}")
        
        base_version = self.job.get('base_version', '')
        if base_version and '@' in base_version:
            sha_short = base_version.split('@')[1][:7]
            metadata_parts.append(f"📎 {sha_short}")
        
        if metadata_parts:
            metadata_text = "  ".join(metadata_parts)
            metadata_textbox = ctk.CTkTextbox(
                parent,
                height=20,
                fg_color="transparent",
                font=ctk.CTkFont(size=11),
                text_color=self.COLORS['text_secondary'],
                wrap="none",
                activate_scrollbars=False
            )
            metadata_textbox.insert("1.0", metadata_text)
            metadata_textbox.configure(state="disabled")  # Read-only but selectable
            metadata_textbox.pack(fill="x", pady=(0, 6))
    
    def _create_verification_steps(self, parent):
        """Create collapsible verification steps section with checkboxes."""
        verification_data = self.job.get('verification_steps')
        verification_steps = verification_data.get('steps', []) if isinstance(verification_data, dict) else []
        
        if not verification_steps:
            return
        
        # Collapsible header
        self.verification_header = ctk.CTkFrame(parent, fg_color="transparent")
        self.verification_header.pack(fill="x", pady=(10, 0))
        
        step_count = len(verification_steps)
        self.verification_toggle = ctk.CTkButton(
            self.verification_header,
            text=f"📋 Verification Steps ({step_count}) ▼",
            fg_color="transparent",
            hover_color=self.COLORS['card_hover'],
            text_color=self.COLORS['text_secondary'],
            anchor="w",
            font=ctk.CTkFont(size=12),
            command=self.toggle_verification_steps,
            height=28
        )
        self.verification_toggle.pack(fill="x")
        
        # Steps container (initially hidden)
        self.steps_container = ctk.CTkFrame(
            parent,
            fg_color=self.COLORS['verification_bg'],
            corner_radius=8
        )
            self.steps_visible = False
        
        # Add steps with checkboxes
        for i, step in enumerate(verification_steps, 1):
            step_frame = ctk.CTkFrame(self.steps_container, fg_color="transparent")
            step_frame.pack(fill="x", padx=12, pady=6)
            
            # Step number badge
            step_number = ctk.CTkLabel(
                step_frame,
                text=str(i),
                fg_color=self.COLORS['accent_blue'],
                text_color=self.COLORS['text_primary'],
                width=22,
                height=22,
                corner_radius=11,
                font=ctk.CTkFont(size=11, weight="bold")
            )
            step_number.pack(side="left", padx=(0, 10))
            
            # Checkbox
            checkbox_var = ctk.BooleanVar(value=self.is_verified)
            checkbox = ctk.CTkCheckBox(
                step_frame,
                text="",
                variable=checkbox_var,
                width=20,
                command=self._on_checkbox_changed,
                fg_color=self.COLORS['accent_green'],
                hover_color=self.COLORS['accent_green_hover']
            )
            checkbox.pack(side="left", padx=(0, 10))
            self.step_checkboxes.append(checkbox_var)
            
            # Step text (selectable)
            step_textbox = ctk.CTkTextbox(
                step_frame,
                height=40,
                fg_color="transparent",
                font=ctk.CTkFont(size=12),
                text_color=self.COLORS['text_primary'],
                wrap="word",
                activate_scrollbars=False
            )
            step_textbox.insert("1.0", step)
            step_textbox.configure(state="disabled")  # Read-only but selectable
            step_textbox.pack(side="left", fill="x", expand=True)
        
        # "Verified?" button below steps
        self.verified_button = ctk.CTkButton(
            self.steps_container,
            text="Verified?" if not self.is_verified else "Verified ✓",
            command=self._toggle_verified,
            fg_color="#f39c12" if not self.is_verified else self.COLORS['accent_green'],
            hover_color="#e67e22" if not self.is_verified else self.COLORS['accent_green_hover'],
            corner_radius=6,
            height=36,
            font=ctk.CTkFont(size=13, weight="bold")
        )
        self.verified_button.pack(fill="x", padx=12, pady=(10, 12))
    
    def _create_actions_section(self):
        """Create action buttons on the right - horizontal layout."""
        actions_frame = ctk.CTkFrame(self, fg_color="transparent")
        actions_frame.grid(row=0, column=2, padx=(15, 20), pady=15, sticky="n")
        
        # View Preview button
        if self.job.get('preview_url'):
            preview_btn = ctk.CTkButton(
                actions_frame,
                text="🔍 Preview",
                command=self._open_preview,
                fg_color=self.COLORS['accent_blue'],
                hover_color=self.COLORS['accent_blue_hover'],
                corner_radius=6,
                height=32,
                width=100,
                font=ctk.CTkFont(size=12, weight="bold")
            )
            preview_btn.pack(side="left", padx=4)
        
        # Remove button (no more "Mark" button - verification handles marking)
        remove_btn = ctk.CTkButton(
            actions_frame,
            text="🗑",
            command=self._on_delete_click,
            fg_color=self.COLORS['accent_red'],
            hover_color=self.COLORS['accent_red_hover'],
            corner_radius=6,
            height=32,
            width=50,
            font=ctk.CTkFont(size=14, weight="bold")
        )
        remove_btn.pack(side="left", padx=4)
    
    def toggle_verification_steps(self):
        """Toggle visibility of verification steps."""
        if self.steps_visible:
            self.steps_container.pack_forget()
            step_count = len(self.job.get('verification_steps', {}).get('steps', []))
            self.verification_toggle.configure(text=f"📋 Verification Steps ({step_count}) ▼")
        else:
            self.steps_container.pack(fill="x", pady=(5, 0))
            step_count = len(self.job.get('verification_steps', {}).get('steps', []))
            self.verification_toggle.configure(text=f"📋 Verification Steps ({step_count}) ▲")
        self.steps_visible = not self.steps_visible
    
    def _on_checkbox_changed(self):
        """Handle individual checkbox changes - check if all are checked."""
        if all(var.get() for var in self.step_checkboxes):
            # All checkboxes checked - mark as verified
            if not self.is_verified:
                self.is_verified = True
                self._update_verified_button()
                self.on_toggle_ready(self.job['id'], True)
    
    def _toggle_verified(self):
        """Toggle verified state - checks/unchecks all boxes."""
        self.is_verified = not self.is_verified
        
        # Update all checkboxes
        for var in self.step_checkboxes:
            var.set(self.is_verified)
        
        # Update button appearance
        self._update_verified_button()
        
        # Notify parent to mark as ready for integration
        if self.is_verified:
            self.on_toggle_ready(self.job['id'], True)
    
    def _update_verified_button(self):
        """Update the verified button appearance."""
        if self.verified_button:
            if self.is_verified:
                self.verified_button.configure(
                    text="Verified ✓",
                    fg_color=self.COLORS['accent_green'],
                    hover_color=self.COLORS['accent_green_hover']
                )
            else:
                self.verified_button.configure(
                    text="Verified?",
                    fg_color="#f39c12",
                    hover_color="#e67e22"
                )

    def _on_delete_click(self):
        """Handle delete button click."""
        self.on_delete(self.job['id'])

    def _open_preview(self):
        """Open preview URL in browser."""
        webbrowser.open_new_tab(self.job['preview_url'])

    def _get_status_display(self, status):
        """Get display text and color for status."""
        status_map = {
            'active': ('IN PROGRESS', self.COLORS['status_active']),
            'waiting_for_review': ('REVIEW', self.COLORS['status_review']),
            'integrated_and_complete': ('DONE', self.COLORS['status_integrated']),
            'failed': ('FAILED', self.COLORS['status_failed']),
            'cancelled': ('CANCELLED', self.COLORS['status_cancelled']),
        }
        return status_map.get(status, ('UNKNOWN', self.COLORS['status_cancelled']))
    
    def update_job_data(self, new_job):
        """Update widget with new job data (for smart updates)."""
        old_status = self.job.get('status')
        new_status = new_job.get('status')
        
        # Update internal reference
        self.job = new_job
        
        # Update title if changed
        new_title = new_job.get('title', 'No Title')
        if self.title_label.cget('text') != new_title:
            self.title_label.configure(text=new_title)
        
        # Update status badge if changed
        if old_status != new_status:
            status_text, status_color = self._get_status_display(new_status)
            self.status_badge.configure(text=status_text, fg_color=status_color)
        
        # Update ready_for_integration state and button if changed
        new_ready_state = new_job.get('ready_for_integration', False)
        if self.is_selected.get() != new_ready_state:
            self.is_selected.set(new_ready_state)
            self._update_mark_button_state()


class ModernGroupHeader(ctk.CTkFrame):
    """Modern group header for job groups."""
    
    def __init__(self, master, base_version, job_count):
        super().__init__(
            master,
            fg_color="#252525",
            corner_radius=8,
            height=44
        )
        
        # Extract SHA from base_version
        sha_display = base_version
        if '@' in base_version:
            branch, sha = base_version.split('@', 1)
            sha_display = f"{branch}@{sha[:7]}"
        
        # Container frame for content
        content_frame = ctk.CTkFrame(self, fg_color="transparent")
        content_frame.pack(fill="both", expand=True, padx=16, pady=10)
        
        # Left: Version info (selectable)
        version_textbox = ctk.CTkTextbox(
            content_frame,
            height=20,
            width=200,
            fg_color="transparent",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#ffffff",
            wrap="none",
            activate_scrollbars=False
        )
        version_textbox.insert("1.0", f"📦 {sha_display}")
        version_textbox.configure(state="disabled")  # Read-only but selectable
        version_textbox.pack(side="left")
        
        # Right: Job count badge
        count_badge = ctk.CTkLabel(
            content_frame,
            text=f"{job_count} job{'s' if job_count != 1 else ''}",
            fg_color="#3498db",
            text_color="#ffffff",
            corner_radius=12,
            padx=12,
            pady=4,
            font=ctk.CTkFont(size=11, weight="bold")
        )
        count_badge.pack(side="right")

