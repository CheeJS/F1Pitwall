using F1Pitwall.Core.Models;
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;


namespace F1Pitwall.Core.Interfaces
{
    public interface IRaceStateService

    {
        Task ApplyUpdateAsync(TimingUpdate update); //Applies a timing update to the current
        RaceState GetCurrentState();  //Gets the current race State
    }
}
