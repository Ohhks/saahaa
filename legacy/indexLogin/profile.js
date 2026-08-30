// ================= LOAD USER DATA =================


let userData =
JSON.parse(localStorage.getItem("user"));



if(userData){


    document.getElementById("username").innerText =
    userData.name;



    document.getElementById("mobile").innerText =
    userData.mobile;


}







// ================= EDIT PROFILE =================


const editButton =
document.getElementById("edit");



editButton.addEventListener("click",()=>{


    let name =
    prompt(
        "Enter your name"
    );



    let mobile =
    prompt(
        "Enter mobile number"
    );




    if(name && mobile){



        let user = {


            name:name,

            mobile:mobile


        };




        localStorage.setItem(

            "user",

            JSON.stringify(user)

        );



        document.getElementById("username").innerText =
        name;



        document.getElementById("mobile").innerText =
        mobile;



        alert(
            "Profile Updated"
        );

    }


});


// ================= NAVIGATION FUNCTIONS =================



function openBookings(){


    window.location.href =
    "booking.html";


}


function openCart(){


    window.location.href =
    "cart.html";


}

function openPartner(){


    window.location.href =
    "partner.html";


}


// ================= LOGOUT =================

const logout =
document.querySelector(".logout");



logout.addEventListener("click",()=>{


    localStorage.removeItem("user");



    alert(
        "Logged out successfully"
    );



    window.location.href =
    "login.html";


});