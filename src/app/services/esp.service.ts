import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

// Estrutura de um agendamento cru, como vem no array "schedulings" do /status
export interface SchedulingRaw {
  id: number;
  hr: number;
  min: number;
  dir: number;   // 1 = ligar (cw) | 2 = desligar (acw)
  canal: number; // 1 ou 2
  prio: number;
}

// Estrutura de um nó (válvula), como vem no array retornado por /status
export interface NodeStatus {
  name_valve: string;
  ID_valve: number;
  estado_canal_1: number; // 0/1 - aberto ou fechado
  estado_canal_2: number;
  clock_updated: boolean;
  clock: string; // "DD/MM/AAAA HH:mm:ss"
  schedulings: SchedulingRaw[];
}

const HOST_STORAGE_KEY = 'samas_esp_host';
const HOST_PADRAO = 'esp.local';

@Injectable({ providedIn: 'root' })
export class EspService {
  constructor(private http: HttpClient) {}

  // O hostname/IP é configurável (tela de Configurações) porque em alguns
  // hotspots (ex: quando o próprio celular que hospeda a rede tenta acessar)
  // a resolução mDNS de "esp.local" não funciona - nesses casos o usuário
  // pode digitar o IP direto (ex: 192.168.43.27) e o app passa a usar ele.
  getHost(): string {
    if (typeof localStorage === 'undefined') return HOST_PADRAO;
    const salvo = localStorage.getItem(HOST_STORAGE_KEY);
    return salvo && salvo.trim() ? salvo.trim() : HOST_PADRAO;
  }

  setHost(host: string) {
    if (typeof localStorage === 'undefined') return;
    const limpo = host.trim();
    if (limpo) {
      localStorage.setItem(HOST_STORAGE_KEY, limpo);
    } else {
      localStorage.removeItem(HOST_STORAGE_KEY); // vazio -> volta pro padrão esp.local
    }
  }

  isHostPadrao(): boolean {
    return this.getHost() === HOST_PADRAO;
  }

  private get baseUrl(): string {
    return `http://${this.getHost()}`;
  }

  setTime(dia: number, mes: number, ano: number, hora: number, min: number, seg: number) {
    const url = `${this.baseUrl}/settime?dia=${dia}&mes=${mes}&ano=${ano}&hora=${hora}&min=${min}&seg=${seg}`;
    return this.http.get(url, { responseType: 'text' });
  }

  setWifi(ssid: string, pass: string) {
    const url = `${this.baseUrl}/wifi/update?ssid=${ssid}&pass=${pass}`;
    return this.http.get(url, { responseType: 'text' });
  }

  getTime() {
    return this.http.get(`${this.baseUrl}/gettime`);
  }

  // Retorna a lista de todos os nós (válvulas) da malha. Além de trazer o
  // status, essa chamada também avisa o Mestre a adiar o adormecimento
  // dos nós em 10s (efeito colateral do lado do firmware).
  getStatus() {
    return this.http.get<NodeStatus[]>(`${this.baseUrl}/status`);
  }

  // Aciona um pulso em tempo real num nó/canal específico.
  // dir: 'cw' (ligar) ou 'acw' (desligar) | id: numero do nó | canal: 1 ou 2
  pulseMotor(dir: 'cw' | 'acw', id: number, canal: number) {
    return this.http.get(`${this.baseUrl}/pulse/${dir}/${id}?canal=${canal}`);
  }

  // Agendamento agora é por nó (targetId na URL) e inclui o canal.
  adicionarAgendamento(targetId: number, id: number, hr: number, min: number, dir: number, canal: number, prio: number) {
    const url = `${this.baseUrl}/program/add/${targetId}?id=${id}&hr=${hr}&min=${min}&dir=${dir}&canal=${canal}&prio=${prio}`;
    return this.http.get(url);
  }

  deletarAgendamento(targetId: number, id: number) {
    return this.http.get(`${this.baseUrl}/program/delete/${targetId}?id=${id}`);
  }
}
