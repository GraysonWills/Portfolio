import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MessageService, ConfirmationService } from 'primeng/api';

import { AuthService } from '../../services/auth.service';
import {
  BlogApiService,
  McpApproval,
  McpClient,
  McpCreateClientRequest
} from '../../services/blog-api.service';

type WorkspaceTab = 'queue' | 'clients';

@Component({
  selector: 'app-ai-queue',
  templateUrl: './ai-queue.component.html',
  styleUrl: './ai-queue.component.scss',
  standalone: false
})
export class AiQueueComponent implements OnInit {
  activeTab: WorkspaceTab = 'queue';
  clients: McpClient[] = [];
  approvals: McpApproval[] = [];
  availableScopes: string[] = [];
  selectedScopes = new Set<string>();
  generatedToken = '';
  generatedClient: McpClient | null = null;
  newClientName = '';
  expiresAt = '';
  approvalStatus = 'pending';
  isLoadingClients = false;
  isLoadingApprovals = false;
  isCreatingClient = false;
  actionBusyId = '';

  readonly scopeDescriptions: Record<string, string> = {
    'site:read': 'Site inventory',
    'content:read': 'Content reads',
    'content:write:draft': 'Content drafts',
    'blog:read': 'Blog reads',
    'blog:write:draft': 'Blog drafts',
    'blog:propose': 'Blog approvals',
    'media:read': 'Media reads',
    'media:write:draft': 'Media drafts',
    'comments:read': 'Comment reads',
    'comments:propose': 'Comment approvals',
    'social:read': 'Social reads',
    'social:write:draft': 'Social drafts',
    'social:propose': 'Social approvals'
  };

  readonly statusOptions = [
    { label: 'Pending', value: 'pending' },
    { label: 'Executed', value: 'executed' },
    { label: 'Rejected', value: 'rejected' },
    { label: 'Failed', value: 'failed' },
    { label: 'All', value: '' }
  ];

  constructor(
    private authService: AuthService,
    private blogApi: BlogApiService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadClients();
    this.loadApprovals();
  }

  setTab(tab: WorkspaceTab): void {
    this.activeTab = tab;
  }

  loadClients(): void {
    this.isLoadingClients = true;
    this.blogApi.getMcpClients().subscribe({
      next: (response) => {
        this.isLoadingClients = false;
        this.clients = response.clients || [];
        this.availableScopes = response.scopes || [];
        if (!this.selectedScopes.size) {
          for (const scope of this.availableScopes) {
            if (scope.includes(':read') || scope === 'blog:write:draft' || scope.endsWith(':propose')) {
              this.selectedScopes.add(scope);
            }
          }
        }
      },
      error: (error) => {
        this.isLoadingClients = false;
        this.messageService.add({
          severity: 'error',
          summary: 'AI Clients',
          detail: error?.message || 'Failed to load MCP clients'
        });
      }
    });
  }

  loadApprovals(): void {
    this.isLoadingApprovals = true;
    this.blogApi.getMcpApprovals(this.approvalStatus).subscribe({
      next: (response) => {
        this.isLoadingApprovals = false;
        this.approvals = response.approvals || [];
      },
      error: (error) => {
        this.isLoadingApprovals = false;
        this.messageService.add({
          severity: 'error',
          summary: 'AI Queue',
          detail: error?.message || 'Failed to load approval queue'
        });
      }
    });
  }

  toggleScope(scope: string, checked: boolean): void {
    if (checked) this.selectedScopes.add(scope);
    else this.selectedScopes.delete(scope);
  }

  isScopeSelected(scope: string): boolean {
    return this.selectedScopes.has(scope);
  }

  createClient(): void {
    const name = this.newClientName.trim();
    if (!name) {
      this.messageService.add({ severity: 'warn', summary: 'Client name required' });
      return;
    }

    const payload: McpCreateClientRequest = {
      name,
      scopes: Array.from(this.selectedScopes),
      ...(this.expiresAt ? { expiresAt: new Date(this.expiresAt).toISOString() } : {})
    };

    this.isCreatingClient = true;
    this.blogApi.createMcpClient(payload).subscribe({
      next: (response) => {
        this.isCreatingClient = false;
        this.generatedToken = response.token;
        this.generatedClient = response.client;
        this.newClientName = '';
        this.expiresAt = '';
        this.loadClients();
        this.messageService.add({
          severity: 'success',
          summary: 'AI Client Created',
          detail: 'Copy the token now. It will not be shown again.'
        });
      },
      error: (error) => {
        this.isCreatingClient = false;
        this.messageService.add({
          severity: 'error',
          summary: 'AI Client',
          detail: error?.message || 'Failed to create MCP client'
        });
      }
    });
  }

  revokeClient(client: McpClient): void {
    this.confirmationService.confirm({
      header: 'Revoke AI Client',
      message: `Revoke "${client.name}"? Existing AI sessions using this token will stop working.`,
      icon: 'pi pi-ban',
      acceptLabel: 'Revoke',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.blogApi.revokeMcpClient(client.clientId).subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Client revoked' });
            this.loadClients();
          },
          error: (error) => {
            this.messageService.add({
              severity: 'error',
              summary: 'Revoke failed',
              detail: error?.message || 'Could not revoke client'
            });
          }
        });
      }
    });
  }

  approve(approval: McpApproval): void {
    this.confirmationService.confirm({
      header: 'Approve AI Action',
      message: approval.summary,
      icon: 'pi pi-check-circle',
      acceptLabel: 'Approve',
      rejectLabel: 'Cancel',
      accept: () => {
        this.actionBusyId = approval.approvalId;
        this.blogApi.approveMcpApproval(approval.approvalId).subscribe({
          next: () => {
            this.actionBusyId = '';
            this.messageService.add({ severity: 'success', summary: 'Approved and executed' });
            this.loadApprovals();
          },
          error: (error) => {
            this.actionBusyId = '';
            this.messageService.add({
              severity: 'error',
              summary: 'Approval failed',
              detail: error?.message || 'Could not execute approval'
            });
            this.loadApprovals();
          }
        });
      }
    });
  }

  reject(approval: McpApproval): void {
    this.confirmationService.confirm({
      header: 'Reject AI Action',
      message: approval.summary,
      icon: 'pi pi-times-circle',
      acceptLabel: 'Reject',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.actionBusyId = approval.approvalId;
        this.blogApi.rejectMcpApproval(approval.approvalId, 'Rejected in Blog Authoring Studio').subscribe({
          next: () => {
            this.actionBusyId = '';
            this.messageService.add({ severity: 'info', summary: 'Rejected' });
            this.loadApprovals();
          },
          error: (error) => {
            this.actionBusyId = '';
            this.messageService.add({
              severity: 'error',
              summary: 'Reject failed',
              detail: error?.message || 'Could not reject approval'
            });
          }
        });
      }
    });
  }

  copyToken(): void {
    if (!this.generatedToken) return;
    navigator.clipboard?.writeText(this.generatedToken).then(() => {
      this.messageService.add({ severity: 'success', summary: 'Token copied' });
    }).catch(() => {
      this.messageService.add({ severity: 'warn', summary: 'Copy unavailable' });
    });
  }

  clearGeneratedToken(): void {
    this.generatedToken = '';
    this.generatedClient = null;
  }

  getStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    const value = String(status || '').toLowerCase();
    if (value === 'active' || value === 'executed') return 'success';
    if (value === 'pending' || value === 'approved') return 'info';
    if (value === 'failed') return 'danger';
    if (value === 'revoked' || value === 'rejected') return 'warn';
    return 'secondary';
  }

  formatJson(value: unknown): string {
    if (!value) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  openPreview(approval: McpApproval): void {
    if (!approval.previewUrl) return;
    window.open(approval.previewUrl, '_blank', 'noopener,noreferrer');
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  goToDistribution(): void {
    this.router.navigate(['/distribution']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  trackByClient(_index: number, client: McpClient): string {
    return client.clientId;
  }

  trackByApproval(_index: number, approval: McpApproval): string {
    return approval.approvalId;
  }

  trackByScope(_index: number, scope: string): string {
    return scope;
  }
}
