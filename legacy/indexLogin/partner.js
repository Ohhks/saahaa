// ================= PARTNER TYPE SELECTION =================


const joinButtons =
document.querySelectorAll(".partner-card button");



joinButtons.forEach((button)=>{


    button.addEventListener("click",()=>{


        let partnerType =
        button.parentElement.querySelector("h3").innerText;



        localStorage.setItem(

            "partnerType",

            partnerType

        );



        alert(

            partnerType + " Selected"

        );



        document.querySelector(".partner-form")
        .scrollIntoView({

            behavior:"smooth"

        });


    });


});







// ================= REGISTRATION FORM =================


const partnerForm =
document.querySelector(".partner-form");



partnerForm.addEventListener("submit",(event)=>{


    event.preventDefault();




    let partnerDetails = {



        name:
        partnerForm.children[0].value,



        mobile:
        partnerForm.children[1].value,



        email:
        partnerForm.children[2].value,



        type:
        partnerForm.children[4].value,



        location:
        partnerForm.children[5].value,



        experience:
        partnerForm.children[6].value



    };






    localStorage.setItem(

        "partnerDetails",

        JSON.stringify(partnerDetails)

    );





    alert(

        "Partner Registration Submitted Successfully!"

    );





    partnerForm.reset();



});







// ================= HERO REGISTER BUTTON =================



const registerButton =
document.querySelector(".hero button");



registerButton.addEventListener("click",()=>{


    document.querySelector(".partner-form")
    .scrollIntoView({

        behavior:"smooth"

    });


});








// ================= SUPPORT CALL =================



const callButton =
document.querySelector(".support-card button");



callButton.addEventListener("click",()=>{


    window.location.href =
    "tel:+919876543210";


});