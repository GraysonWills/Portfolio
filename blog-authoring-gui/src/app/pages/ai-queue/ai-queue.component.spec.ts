import { of } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { Router } from '@angular/router';

import { AiQueueComponent } from './ai-queue.component';
import { AuthService } from '../../services/auth.service';
import { BlogApiService } from '../../services/blog-api.service';

describe('AiQueueComponent', () => {
  function createComponent() {
    const authService = {
      isAuthenticated: jasmine.createSpy('isAuthenticated').and.returnValue(true),
      logout: jasmine.createSpy('logout')
    } as unknown as AuthService;
    const blogApi = {
      getApiEndpoint: jasmine.createSpy('getApiEndpoint').and.returnValue('https://api.example.test/api'),
      getMcpClients: jasmine.createSpy('getMcpClients').and.returnValue(of({ clients: [], scopes: [] })),
      getMcpApprovals: jasmine.createSpy('getMcpApprovals').and.returnValue(of({ approvals: [] })),
      createMcpClient: jasmine.createSpy('createMcpClient').and.returnValue(of({
        client: {
          clientId: 'client-1',
          name: 'Local agent',
          scopes: [],
          autoExecuteActions: [],
          status: 'active',
          ownerSub: 'author-sub',
          createdBy: 'author@example.com',
          createdAt: null,
          updatedAt: null,
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          limits: { read: 100, draftMutation: 20, approvalMutation: 10 }
        },
        token: 'mcp_created-token'
      }))
    } as unknown as BlogApiService;
    const messageService = {
      add: jasmine.createSpy('add')
    } as unknown as MessageService;
    const confirmationService = {
      confirm: jasmine.createSpy('confirm')
    } as unknown as ConfirmationService;
    const router = {
      navigate: jasmine.createSpy('navigate')
    } as unknown as Router;

    return new AiQueueComponent(authService, blogApi, messageService, confirmationService, router);
  }

  it('applies scoped client presets', () => {
    const component = createComponent();
    component.availableScopes = [
      'site:read',
      'content:read',
      'content:write:draft',
      'blog:read',
      'blog:write:draft',
      'blog:propose',
      'media:write:draft',
      'social:write:draft'
    ];

    component.applyScopePreset('readOnly');
    expect(Array.from(component.selectedScopes)).toEqual(['site:read', 'content:read', 'blog:read']);

    component.applyScopePreset('draftOnly');
    expect(component.isScopeSelected('blog:write:draft')).toBeTrue();
    expect(component.isScopeSelected('media:write:draft')).toBeTrue();
    expect(component.isScopeSelected('blog:propose')).toBeFalse();

    component.applyScopePreset('full');
    expect(component.selectedScopes.size).toBe(component.availableScopes.length);
  });

  it('applies auto-execute presets and marks risky actions', () => {
    const component = createComponent();
    component.availableAutoExecuteActions = [
      'blog.propose_update',
      'blog.request_publish',
      'blog.request_delete',
      'social.request_send_delivery'
    ];
    component.recommendedAutoExecuteActions = ['blog.propose_update', 'blog.request_publish'];
    component.riskyAutoExecuteActions = ['blog.request_delete', 'social.request_send_delivery'];

    component.applyAutoExecutePreset('recommended');
    expect(Array.from(component.selectedAutoExecuteActions)).toEqual(['blog.propose_update', 'blog.request_publish']);
    expect(component.isRiskyAutoAction('blog.request_delete')).toBeTrue();

    component.applyAutoExecutePreset('full');
    expect(component.selectedAutoExecuteActions.size).toBe(component.availableAutoExecuteActions.length);

    component.applyAutoExecutePreset('none');
    expect(component.selectedAutoExecuteActions.size).toBe(0);
  });

  it('includes selected auto-execute actions when creating a client', () => {
    const component = createComponent();
    const blogApi = (component as any).blogApi as jasmine.SpyObj<BlogApiService>;
    component.newClientName = 'Local agent';
    component.selectedScopes.add('blog:read');
    component.selectedAutoExecuteActions.add('blog.propose_update');
    component.selectedAutoExecuteActions.add('blog.request_publish');

    component.createClient();

    expect(blogApi.createMcpClient).toHaveBeenCalledWith(jasmine.objectContaining({
      name: 'Local agent',
      scopes: ['blog:read'],
      autoExecuteActions: ['blog.propose_update', 'blog.request_publish']
    }));
  });

  it('builds keychain and MCP config snippets without embedding the one-time token', () => {
    const component = createComponent();
    component.generatedToken = 'mcp_sensitive-token';

    expect(component.getMcpEndpoint()).toBe('https://api.example.test/api/mcp');
    expect(component.getKeychainCommand()).toContain('security add-generic-password');
    expect(component.getKeychainCommand()).not.toContain(component.generatedToken);
    expect(component.getMcpConfigSnippet()).toContain('portfolio-blog-authoring');
    expect(component.getMcpConfigSnippet()).toContain('${MCP_BEARER_TOKEN}');
    expect(component.getMcpConfigSnippet()).not.toContain(component.generatedToken);
  });
});
