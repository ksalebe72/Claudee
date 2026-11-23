import React from 'react';
import { Link } from 'react-router-dom';
import { money, fmtDate } from '../utils.js';

/** Tabla de clientes sin comprar (tablero y lista completa). Días en naranja pasado el límite y en rojo al doble. */
export default function TablaClientesInactivos({ lista, dias, completa = false }) {
  const conMontos = lista.some((c) => c.ventas !== undefined);
  return (
    <div className="tabla-desliza">
      <table className={`table ${completa ? '' : 'mini-table'}`}>
        <thead>
          <tr>
            <th>Cliente</th>{completa && <th>Contacto</th>}{completa && <th>Teléfono</th>}<th>Última compra</th>
            <th className="num">Días</th><th className="num">Compras</th>{conMontos && <th className="num">Vendido s/imp.</th>}<th>Vendedor</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((c) => (
            <tr key={c.id}>
              <td><Link to={`/contactos/${c.id}`}><strong>{c.cliente}</strong></Link>{c.cotizacionesAbiertas > 0 && <span className="badge tone-blue" style={{ marginLeft: 6 }}>cotización abierta</span>}</td>
              {completa && <td>{c.contacto}</td>}{completa && <td>{c.telefono}</td>}
              <td>{fmtDate(c.ultimaCompra)}</td>
              <td className={`num ${c.dias > dias * 2 ? 'danger' : 'warn-txt'}`}>{c.dias}</td>
              <td className="num">{c.compras}</td>
              {conMontos && <td className="num">{money(c.ventas)}</td>}
              <td className="muted">{c.vendedor || 'sin asignar'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
