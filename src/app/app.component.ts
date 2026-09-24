import { Component, OnInit, OnDestroy, HostListener, PLATFORM_ID, Inject } from '@angular/core'; // Adicione OnInit, OnDestroy, HostListener, PLATFORM_ID, Inject
import { isPlatformBrowser, CommonModule } from '@angular/common'; // Adicione isPlatformBrowser
import { RouterLink, RouterOutlet } from '@angular/router';
import { SwPush, SwUpdate } from '@angular/service-worker';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { 
  IonButtons, 
  IonButton,
  IonContent, 
  IonHeader, 
  IonMenu, 
  IonMenuToggle,
  IonTitle, 
  IonToolbar } from '@ionic/angular';
import { IonIcon } from '@ionic/angular';
import { menu } from 'ionicons/icons';
import { addIcons } from 'ionicons';
import { logoIonic } from 'ionicons/icons';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    CommonModule,
    IonButtons, 
    IonButton,
    IonContent, 
    IonHeader, 
    IonMenu, 
    IonMenuToggle,
    IonTitle, 
    IonToolbar,
    IonHeader, 
    IonToolbar, 
    IonTitle, 
    IonButtons, 
    IonMenuToggle,
    IonContent,
    IonIcon
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  menuIcon = menu;
  title = 'MeuSite';
  private deferredInstallPrompt: any = null; // Para guardar o evento 'beforeinstallprompt'
  showInstallButton = false; // Controla a visibilidade do seu botão customizado
  private isBrowser: boolean;

  constructor(
    private pushSw: SwPush,
    private update: SwUpdate,
    private snackBar: MatSnackBar,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit(): void {
    if (this.isBrowser) {
      this.setupInstallPromptListener();
      this.handleAppUpdates();
      // A lógica de SwPush pode ser mantida ou expandida aqui
      // this.pushSw.messages.subscribe(msg => console.log('Push message recebida: ', msg));
    }
  }

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstallPrompt(event: Event) {
    if (this.isBrowser) {
      console.log('Evento beforeinstallprompt capturado!');
      // Previne o mini-infobar do Chrome de aparecer.
      event.preventDefault();
      // Guarda o evento para que possa ser acionado depois.
      this.deferredInstallPrompt = event;
      // Mostra seu botão de instalação customizado.
      this.showInstallButton = true;
    }
  }

  private setupInstallPromptListener(): void {
    // Algumas versões de navegadores/plataformas podem não usar @HostListener diretamente
    // para 'beforeinstallprompt' ou você pode querer um controle mais fino.
    // Esta é uma alternativa/complemento ao @HostListener.
    window.addEventListener('beforeinstallprompt', (event) => {
      if (!this.deferredInstallPrompt) { // Evita registrar múltiplas vezes se @HostListener já pegou
        console.log('Evento beforeinstallprompt capturado via addEventListener!');
        event.preventDefault();
        this.deferredInstallPrompt = event;
        this.showInstallButton = true;
        // É importante forçar a detecção de mudanças se estiver fora do contexto Angular
        // mas como estamos em ngOnInit e showInstallButton afeta o template, Angular deve pegar.
      }
    });

    window.addEventListener('appinstalled', () => {
      console.log('PWA instalado com sucesso!');
      // Esconder o botão de instalação customizado pois o app já foi instalado
      this.showInstallButton = false;
      this.deferredInstallPrompt = null;
      this.snackBar.open('Aplicativo instalado com sucesso!', 'Fechar', { duration: 3000 });
    });
  }


  handleAppUpdates(): void {
    this.update.versionUpdates.subscribe(event => {
      if (event.type === 'VERSION_READY') {
        const snack = this.snackBar.open('Nova versão disponível!', 'Recarregar', { duration: 10000 });
        snack.onAction().subscribe(() => {
          window.location.reload();
        });
      }
    });
  }

  installPWA(): void {
    if (!this.deferredInstallPrompt) {
      console.log('O prompt de instalação não está disponível.');
      this.snackBar.open('O prompt de instalação não está disponível no momento.', 'Fechar', { duration: 3000 });
      return;
    }
    // Mostra o prompt de instalação
    this.deferredInstallPrompt.prompt();
    // Espera o usuário responder ao prompt
    this.deferredInstallPrompt.userChoice.then((choiceResult: { outcome: string }) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('Usuário aceitou o prompt de instalação do PWA');
      } else {
        console.log('Usuário recusou o prompt de instalação do PWA');
      }
      // O evento `appinstalled` será disparado separadamente se a instalação for bem-sucedida.
      // Podemos limpar o prompt aqui, pois ele só pode ser usado uma vez.
      this.deferredInstallPrompt = null;
      // Mesmo que recusado, geralmente escondemos o botão até que `beforeinstallprompt` dispare novamente.
      this.showInstallButton = false;
    });
  }

  ngOnDestroy(): void {
    if (this.isBrowser) {
      // Limpar listeners se necessário, embora o Angular geralmente cuide disso para @HostListener.
      // window.removeEventListener('beforeinstallprompt', ...);
      // window.removeEventListener('appinstalled', ...);
    }
  }
}