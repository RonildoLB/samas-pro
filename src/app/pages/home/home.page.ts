import { IonHeader, IonToolbar, IonTitle, IonContent, IonMenu, IonButton, 
  IonItem, IonMenuToggle, IonRadio, IonRadioGroup, IonSpinner
} from '@ionic/angular';
import { IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle } from '@ionic/angular';
import { Component, OnInit, OnDestroy, ChangeDetectorRef, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { EspService, NodeStatus, SchedulingRaw } from '../../services/esp.service';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { timer, Subscription, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

const CANAL2_VISIVEL_PREFIXO = 'samas_canal2_visivel_no_';
const TEMPO_PROGRESSO_MS = 5000;
const INTERVALO_STATUS_MS = 5000;

// Chave única por válvula+canal, usada para indexar os mapas de estado otimista.
function chaveCanal(idValvula: number, canal: 1 | 2): string {
  return `${idValvula}:${canal}`;
}

// Retorna o próximo minuto múltiplo de 5 a partir de agora, formatado "HH:MM".
// Se o minuto atual já é múltiplo de 5, retorna o PRÓXIMO (ex: às 10:50:30,
// retorna "10:55", pois o minuto 10:50 já está em curso/passado).
function proximoMultiploDe5(): string {
  const agora = new Date();
  const minutosDesdeMeiaNoite = agora.getHours() * 60 + agora.getMinutes();
  const proximo = (Math.floor(minutosDesdeMeiaNoite / 5) + 1) * 5;
  const h = Math.floor(proximo / 60) % 24;
  const m = proximo % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}`;
}

// True quando o relógio local está dentro do minuto múltiplo de 5 em curso
// (ex: entre 10:50:00 e 10:50:59).
function dentroDoMinutoMultiploDe5(): boolean {
  return new Date().getMinutes() % 5 === 0;
}

// INTERFACES
interface AgendamentoPar {
  idLigar?: number;
  idDesligar?: number;
  hrLigar?: number;
  minLigar?: number;
  hrDesligar?: number;
  minDesligar?: number;
  pendente?: boolean;
  removendoPendente?: boolean;
}

interface ValvulaView {
  id: number;
  nome: string;
  estadoCanal1: boolean;
  estadoCanal2: boolean;
  clockAtualizado: boolean;
  clock: string;
  canal2Visivel: boolean;

  agendamentosCanal1: AgendamentoPar[];
  agendamentosCanal2: AgendamentoPar[];

  loadingLigarC1: boolean;
  loadingDesligarC1: boolean;
  loadingLigarC2: boolean;
  loadingDesligarC2: boolean;

  novoHoraLigarC1: string;
  novoHoraDesligarC1: string;
  novoHoraLigarC2: string;
  novoHoraDesligarC2: string;
}
/*-------------------------------------*/

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonMenu,
    IonButton, IonContent, IonHeader, IonItem, IonMenu, IonMenuToggle,
    IonRadio, IonRadioGroup, IonTitle, IonToolbar, FormsModule, 
    IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle,
    IonSpinner
  ],
})

export class HomePage implements OnInit, OnDestroy {
  // VARIÁVEIS
  connected = false;
  valvulas: ValvulaView[] = [];
  dataEsp: string = '';
  horaEsp: string = '';
  ssidEsp: string = '';
  passEsp: string = '';
  horaRecebida: string | null = null;
  hostEsp: string = 'esp.local';
  mostrarRelogioCard: boolean = false;
  proximoHorarioDisponivel: string = proximoMultiploDe5();
  /*----------------------------*/

  private statusSubscription?: Subscription;
  private relogioSubscription?: Subscription;
  private isBrowser: boolean;
  private dentroDaJanelaRelogio: boolean = dentroDoMinutoMultiploDe5();
  private statusConfirmouNosAtivos: boolean = false;
  private adicionadosPendentes = new Map<string, AgendamentoPar[]>();
  private removidosPendentes = new Map<string, Set<number>>();

  constructor(
    private esp: EspService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  get nodesAcordados(): boolean {
    return this.dentroDaJanelaRelogio || this.statusConfirmouNosAtivos;
  }

  ngOnInit() {
    this.hostEsp = this.esp.getHost();

    this.statusSubscription = timer(0, INTERVALO_STATUS_MS)
      .pipe(
        switchMap(() => this.esp.getStatus().pipe(
          catchError((err) => {
            console.error('Erro ao buscar status:', err);
            return of(null); // não deixa o erro matar o timer/polling
          })
        ))
      )
      .subscribe((resp: NodeStatus[] | null) => {
        if (resp === null) {
          // /status não respondeu - não temos confirmação de rede de que os
          // nós estão ativos (a janela do relógio, se estiver em curso,
          // continua valendo por conta própria).
          this.statusConfirmouNosAtivos = false;
          this.cdr.detectChanges();
          return;
        }
        // O /status é servido pelo Root, que está sempre ligado - ele
        // responder com sucesso NÃO significa que os nós (que dormem)
        // estão acordados. Só considera confirmado se a lista realmente
        // trouxer pelo menos um nó reportado.
        this.statusConfirmouNosAtivos = Array.isArray(resp) && resp.length > 0;
        this.atualizarValvulas(resp);
      });

    // Recalcula a cada segundo: o rótulo "Espere até HH:MM" (caso o minuto
    // vire) e a janela teórica de despertar - liga E desliga junto com o
    // minuto múltiplo de 5, sem esperar o próximo ciclo do /status (que só
    // roda a cada 5s).
    this.relogioSubscription = timer(0, 1000).subscribe(() => {
      this.proximoHorarioDisponivel = proximoMultiploDe5();
      this.dentroDaJanelaRelogio = dentroDoMinutoMultiploDe5();
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    this.statusSubscription?.unsubscribe();
    this.relogioSubscription?.unsubscribe();
  }

  private atualizarValvulas(lista: NodeStatus[]) {
    this.connected = Array.isArray(lista) && lista.length > 0;

    this.valvulas = (lista || []).map((no) => {
      const anterior = this.valvulas.find(v => v.id === no.ID_valve);

      const { canal1, canal2 } = this.separarPorCanal(no.schedulings);

      return {
        id: no.ID_valve,
        nome: no.name_valve,
        estadoCanal1: !!no.estado_canal_1,
        estadoCanal2: !!no.estado_canal_2,
        clockAtualizado: no.clock_updated,
        clock: no.clock,
        canal2Visivel: anterior ? anterior.canal2Visivel : this.lerCanal2Visivel(no.ID_valve),

        agendamentosCanal1: this.reconciliarComPendentes(no.ID_valve, 1, this.agruparEmDuplas(canal1)),
        agendamentosCanal2: this.reconciliarComPendentes(no.ID_valve, 2, this.agruparEmDuplas(canal2)),

        loadingLigarC1: anterior?.loadingLigarC1 ?? false,
        loadingDesligarC1: anterior?.loadingDesligarC1 ?? false,
        loadingLigarC2: anterior?.loadingLigarC2 ?? false,
        loadingDesligarC2: anterior?.loadingDesligarC2 ?? false,

        novoHoraLigarC1: anterior?.novoHoraLigarC1 ?? '',
        novoHoraDesligarC1: anterior?.novoHoraDesligarC1 ?? '',
        novoHoraLigarC2: anterior?.novoHoraLigarC2 ?? '',
        novoHoraDesligarC2: anterior?.novoHoraDesligarC2 ?? '',
      };
    });

    this.cdr.detectChanges();
  }

  private reconciliarComPendentes(idValvula: number, canal: 1 | 2, paresReais: AgendamentoPar[]): AgendamentoPar[] {
    const chave = chaveCanal(idValvula, canal);

    // Adição: descarta provisórios cujo id já apareceu na lista real
    const provisorios = this.adicionadosPendentes.get(chave) ?? [];
    if (provisorios.length > 0) {
      const idsReais = new Set(paresReais.flatMap(p => [p.idLigar, p.idDesligar]).filter(id => id !== undefined));
      const aindaProvisorios = provisorios.filter(p =>
        !(p.idLigar !== undefined && idsReais.has(p.idLigar)) &&
        !(p.idDesligar !== undefined && idsReais.has(p.idDesligar))
      );
      if (aindaProvisorios.length !== provisorios.length) {
        this.adicionadosPendentes.set(chave, aindaProvisorios);
      }
    }

    // Remoção: limpa os ids marcados que já não aparecem mais na lista real
    const marcadosRemocao = this.removidosPendentes.get(chave);
    if (marcadosRemocao && marcadosRemocao.size > 0) {
      const idsReais = new Set(paresReais.flatMap(p => [p.idLigar, p.idDesligar]).filter(id => id !== undefined));
      for (const id of Array.from(marcadosRemocao)) {
        if (!idsReais.has(id)) {
          marcadosRemocao.delete(id);
        }
      }
    }

    // Aplica a marca visual de "removendo" nos pares reais ainda pendentes de exclusão
    const paresComMarcaRemocao = paresReais.map(p => {
      const marcado = (p.idLigar !== undefined && marcadosRemocao?.has(p.idLigar)) ||
                      (p.idDesligar !== undefined && marcadosRemocao?.has(p.idDesligar));
      return marcado ? { ...p, removendoPendente: true } : p;
    });

    const provisoriosAtuais = (this.adicionadosPendentes.get(chave) ?? []).map(p => ({ ...p, pendente: true }));
    return [...paresComMarcaRemocao, ...provisoriosAtuais];
  }

  private separarPorCanal(schedulings: SchedulingRaw[]): { canal1: SchedulingRaw[]; canal2: SchedulingRaw[] } {
    const canal1 = (schedulings || []).filter(s => s.canal === 1);
    const canal2 = (schedulings || []).filter(s => s.canal === 2);
    return { canal1, canal2 };
  }

  private agruparEmDuplas(lista: SchedulingRaw[]): AgendamentoPar[] {
    const ligar = lista.filter(s => s.dir === 1).sort((a, b) => a.id - b.id);
    const desligar = lista.filter(s => s.dir === 2).sort((a, b) => a.id - b.id);
    const duplas: AgendamentoPar[] = [];

    const total = Math.max(ligar.length, desligar.length);
    for (let i = 0; i < total; i++) {
      const l = ligar[i];
      const d = desligar[i];
      duplas.push({
        idLigar: l?.id,
        idDesligar: d?.id,
        hrLigar: l?.hr,
        minLigar: l?.min,
        hrDesligar: d?.hr,
        minDesligar: d?.min,
      });
    }
    return duplas;
  }

  private lerCanal2Visivel(idNo: number): boolean {
    if (!this.isBrowser) return true;
    const valor = localStorage.getItem(CANAL2_VISIVEL_PREFIXO + idNo);
    return valor === null ? true : valor === '1';
  }

  toggleCanal2Visivel(valvula: ValvulaView) {
    valvula.canal2Visivel = !valvula.canal2Visivel;
    if (this.isBrowser) {
      localStorage.setItem(CANAL2_VISIVEL_PREFIXO + valvula.id, valvula.canal2Visivel ? '1' : '0');
    }
  }

  acionarMotorProgresso(valvula: ValvulaView, direcao: 'cw' | 'acw', canal: 1 | 2) {
    const loadingKey = this.chaveLoading(direcao, canal);
    if (valvula[loadingKey]) return; // Trava de segurança

    valvula[loadingKey] = true;
    const idValvula = valvula.id;

    const resetarLoading = () => {
      const atual = this.valvulas.find(v => v.id === idValvula);
      if (atual) atual[loadingKey] = false;
      this.cdr.detectChanges();
    };

    this.esp.pulseMotor(direcao, valvula.id, canal).subscribe({
      next: (resp) => {
        console.log(`Motor acionado: no ${valvula.id} canal ${canal} dir ${direcao}`, resp);
        setTimeout(resetarLoading, TEMPO_PROGRESSO_MS);
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao acionar motor:', err);
        resetarLoading();
      }
    });
  }

  private chaveLoading(direcao: 'cw' | 'acw', canal: 1 | 2): 'loadingLigarC1' | 'loadingDesligarC1' | 'loadingLigarC2' | 'loadingDesligarC2' {
    if (canal === 1) return direcao === 'cw' ? 'loadingLigarC1' : 'loadingDesligarC1';
    return direcao === 'cw' ? 'loadingLigarC2' : 'loadingDesligarC2';
  }

  motorDesabilitado(valvula: ValvulaView, canal: 1 | 2): boolean {
    if (!this.connected || !this.nodesAcordados) return true;
    return canal === 1
      ? (valvula.loadingLigarC1 || valvula.loadingDesligarC1)
      : (valvula.loadingLigarC2 || valvula.loadingDesligarC2);
  }

  adicionarAgendamento(valvula: ValvulaView, canal: 1 | 2) {
    const horaLigar = canal === 1 ? valvula.novoHoraLigarC1 : valvula.novoHoraLigarC2;
    const horaDesligar = canal === 1 ? valvula.novoHoraDesligarC1 : valvula.novoHoraDesligarC2;

    if (!horaLigar || !horaDesligar) {
      alert('Preencha os horários de Ligar e Desligar.');
      return;
    }

    const [hrLigar, minLigar] = horaLigar.split(':').map(Number);
    const idLigar = Math.floor(Math.random() * 10000);

    this.esp.adicionarAgendamento(valvula.id, idLigar, hrLigar, minLigar, 1, canal, 1).subscribe(() => {
      const [hrDesligar, minDesligar] = horaDesligar.split(':').map(Number);
      const idDesligar = Math.floor(Math.random() * 10000);

      this.esp.adicionarAgendamento(valvula.id, idDesligar, hrDesligar, minDesligar, 2, canal, 1).subscribe(() => {
        // Confirmado que o Mestre aceitou o pedido - mostra na hora,
        // mesmo antes do nó/mesh confirmarem de fato (só chega no /status
        // depois do próximo ciclo do nó).
        const chave = chaveCanal(valvula.id, canal);
        const provisorios = this.adicionadosPendentes.get(chave) ?? [];
        provisorios.push({
          idLigar, idDesligar,
          hrLigar, minLigar,
          hrDesligar, minDesligar,
        });
        this.adicionadosPendentes.set(chave, provisorios);

        if (canal === 1) {
          valvula.agendamentosCanal1 = this.reconciliarComPendentes(valvula.id, 1,
            valvula.agendamentosCanal1.filter(p => !p.pendente));
          valvula.novoHoraLigarC1 = '';
          valvula.novoHoraDesligarC1 = '';
        } else {
          valvula.agendamentosCanal2 = this.reconciliarComPendentes(valvula.id, 2,
            valvula.agendamentosCanal2.filter(p => !p.pendente));
          valvula.novoHoraLigarC2 = '';
          valvula.novoHoraDesligarC2 = '';
        }
        this.cdr.detectChanges();
      });
    });
  }

  deletarDupla(valvula: ValvulaView, par: AgendamentoPar, canal: 1 | 2) {
    const excluirLigar = par.idLigar !== undefined
      ? this.esp.deletarAgendamento(valvula.id, par.idLigar)
      : null;
    const excluirDesligar = par.idDesligar !== undefined
      ? this.esp.deletarAgendamento(valvula.id, par.idDesligar)
      : null;

    const chave = chaveCanal(valvula.id, canal);
    const marcados = this.removidosPendentes.get(chave) ?? new Set<number>();
    if (par.idLigar !== undefined) marcados.add(par.idLigar);
    if (par.idDesligar !== undefined) marcados.add(par.idDesligar);
    this.removidosPendentes.set(chave, marcados);

    // Se o par era provisório (ainda não confirmado pelo /status), já
    // remove da lista de pendentes de adição também.
    const provisorios = this.adicionadosPendentes.get(chave);
    if (provisorios) {
      this.adicionadosPendentes.set(chave, provisorios.filter(p =>
        p.idLigar !== par.idLigar || p.idDesligar !== par.idDesligar
      ));
    }

    if (canal === 1) {
      valvula.agendamentosCanal1 = this.reconciliarComPendentes(valvula.id, 1,
        valvula.agendamentosCanal1.filter(p => p !== par || !p.pendente));
    } else {
      valvula.agendamentosCanal2 = this.reconciliarComPendentes(valvula.id, 2,
        valvula.agendamentosCanal2.filter(p => p !== par || !p.pendente));
    }
    this.cdr.detectChanges();

    const prosseguir = () => {
      if (excluirDesligar) {
        excluirDesligar.subscribe(() => {
          // O proximo ciclo do /status ja vem sem esse par
        });
      }
    };

    if (excluirLigar) {
      excluirLigar.subscribe(() => prosseguir());
    } else {
      prosseguir();
    }
  }

  salvarHost() {
    this.esp.setHost(this.hostEsp);
    this.hostEsp = this.esp.getHost(); // normaliza (ex: campo vazio -> esp.local)
  }

  restaurarHostPadrao() {
    this.esp.setHost('');
    this.hostEsp = this.esp.getHost();
  }

  private formatarHora(h: any): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(h.dia)}/${pad(h.mes)}/${h.ano.toString().slice(-2)} ${pad(h.hora)}:${pad(h.min)}:${pad(h.seg)}`;
  }

  enviarDataHora() {
    if (!this.dataEsp || !this.horaEsp) {
      alert('Preencha a data e a hora.');
      return;
    }

    const [ano, mes, dia] = this.dataEsp.split('-').map(Number);
    const [hora, min, seg] = this.horaEsp.split(':').map(Number);
    const s = seg || 0;

    this.esp.setTime(dia, mes, ano, hora, min, s).subscribe(() => {
      console.log('Relógio sincronizado');
      this.lerHoraEsp();
    });
  }

  atualizarWifi() {
    if (!this.ssidEsp || !this.passEsp) {
      alert('Preencha os campos SSID e Senha.');
      return;
    }

    this.esp.setWifi(this.ssidEsp, this.passEsp).subscribe(() => {
      console.log('Wifi atualizado');
    });
  }

  lerHoraEsp() {
    this.esp.getTime().subscribe((t: any) => {
      this.horaRecebida = this.formatarHora(t);
      this.cdr.detectChanges();
    });
  }

}
